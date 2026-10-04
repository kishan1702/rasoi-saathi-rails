'use strict';
// MOCK of Delhivery's B2C API. Paths and field names mirror Delhivery; data is synthetic.
// Demo triggers (deterministic, so failure paths can be shown on purpose):
//   - pincode ending in 99, or listed in DLV_UNSERVICEABLE_PINS  -> not serviceable (empty delivery_codes)
//   - pickup_time before 07:00 or from 21:00, or pickup_location containing NORIDER -> no pickup capacity
//   - shipment order ref ending in -LATE  -> delivery takes twice as long
//   - shipment order ref ending in -UNDEL -> ends as Undelivered (consignee unavailable)
//   - any waybill this mock did not issue -> "No such waybill"
const { ok, fail, hashInt, iso } = require('./util');
const store = require('./store');

const CITIES = { 11: ['New Delhi', 'DL'], 12: ['Gurugram', 'HR'], 20: ['Noida', 'UP'], 40: ['Mumbai', 'MH'], 41: ['Pune', 'MH'], 56: ['Bengaluru', 'KA'], 60: ['Chennai', 'TN'], 50: ['Hyderabad', 'TS'], 70: ['Kolkata', 'WB'], 38: ['Ahmedabad', 'GJ'], 30: ['Jaipur', 'RJ'], 22: ['Lucknow', 'UP'] };
const cityOf = (pin) => CITIES[String(pin).slice(0, 2)] || ['Other', 'IN'];
const validPin = (p) => /^[1-9]\d{5}$/.test(String(p || ''));
const blocked = () => (process.env.DLV_UNSERVICEABLE_PINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const serviceable = (pin) => validPin(pin) && !String(pin).endsWith('99') && !blocked().includes(String(pin));

// Stage durations in minutes for the hyperlocal store-to-home lane.
const BASE_MIN = Number(process.env.DLV_DELIVERY_MINUTES || 40);

function checksum(s12) { return String(hashInt('wb' + s12) % 100).padStart(2, '0'); }
function makeWaybill(orderRef, scenario) {
  const body = String(Math.floor(Date.now() / 1000)).padStart(10, '0') + String(scenario) + String(hashInt(orderRef) % 10);
  return body + checksum(body);
}
function parseWaybill(wb) {
  const s = String(wb || '');
  if (!/^\d{14}$/.test(s) || checksum(s.slice(0, 12)) !== s.slice(12)) return null;
  return { createdMs: Number(s.slice(0, 10)) * 1000, scenario: Number(s[10]) };
}

async function pincode({ filter_codes }) {
  const pins = String(filter_codes || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!pins.length) return fail(400, 'missing_filter_codes', 'filter_codes is required');
  const delivery_codes = pins.filter(serviceable).map((pin) => {
    const [city, st] = cityOf(pin);
    return { postal_code: { pin: Number(pin), city, district: city, state_code: st, country_code: 'IN', pre_paid: 'Y', cod: 'Y', pickup: 'Y', repl: 'N', cash: 'Y', is_oda: 'N', max_amount: 50000, max_weight: 20000, remarks: '' } };
  });
  return ok({ delivery_codes });
}

async function charges(a) {
  for (const k of ['md', 'ss', 'o_pin', 'd_pin', 'cgm', 'pt']) if (a[k] === undefined || a[k] === '') return fail(400, 'missing_param', `${k} is required`);
  if (!validPin(a.o_pin) || !validPin(a.d_pin)) return fail(400, 'invalid_pin', 'o_pin and d_pin must be 6-digit pincodes');
  if (!serviceable(a.d_pin)) return fail(400, 'not_serviceable', `Destination pincode ${a.d_pin} is not serviceable`);
  const cgm = Math.max(1, Number(a.cgm) || 0);
  const o = String(a.o_pin), d = String(a.d_pin);
  const zone = o.slice(0, 3) === d.slice(0, 3) ? 'A' : o.slice(0, 2) === d.slice(0, 2) ? 'B' : o[0] === d[0] ? 'C' : 'D';
  const base = { A: 25, B: 35, C: 55, D: 75 }[zone];
  const slabs = Math.ceil(cgm / 500);
  let dl = base + (slabs - 1) * { A: 10, B: 14, C: 22, D: 30 }[zone];
  if (a.md === 'E') dl = Math.round(dl * 1.4);
  const cod = a.pt === 'COD' ? 30 : 0;
  const gross = dl + cod;
  const tax = Math.round(gross * 0.18 * 100) / 100;
  return ok([{ status: 'Delivered', zone, charged_weight: slabs * 500, charge_DL: dl, charge_COD: cod, charge_FSC: 0, gross_amount: gross, tax_data: { IGST: zone === 'A' || zone === 'B' ? 0 : tax, CGST: zone === 'A' || zone === 'B' ? tax / 2 : 0, SGST: zone === 'A' || zone === 'B' ? tax / 2 : 0 }, total_amount: Math.round((gross + tax) * 100) / 100, currency: 'INR' }]);
}

async function createShipment(a) {
  let data = a.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { return fail(400, 'invalid_data', 'data must be JSON'); } }
  if (!data || !Array.isArray(data.shipments) || !data.shipments.length) return fail(400, 'missing_shipments', 'data.shipments is required');
  if (!data.pickup_location || !data.pickup_location.name) return fail(400, 'missing_pickup_location', 'data.pickup_location.name is required');
  const packages = [];
  for (const s of data.shipments) {
    const miss = ['name', 'add', 'pin', 'order', 'payment_mode'].filter((k) => !s[k]);
    if (miss.length) { packages.push({ status: 'Fail', refnum: s.order || null, waybill: '', serviceable: false, remarks: [`Missing fields: ${miss.join(', ')}`] }); continue; }
    if (!serviceable(s.pin)) { packages.push({ status: 'Fail', refnum: s.order, waybill: '', serviceable: false, remarks: [`Pincode ${s.pin} is not serviceable`] }); continue; }
    const existing = await store.get(`dlv:order:${s.order}`);
    if (existing) { packages.push({ status: 'Fail', refnum: s.order, waybill: existing, serviceable: true, remarks: ['Duplicate order id: a shipment already exists for this order; its waybill is returned'] }); continue; }
    const scenario = /-UNDEL$/i.test(s.order) ? 2 : /-LATE$/i.test(s.order) ? 1 : 0;
    const waybill = makeWaybill(s.order, scenario);
    await store.set(`dlv:order:${s.order}`, waybill);
    await store.set(`dlv:wb:${waybill}`, { order: s.order, pin: String(s.pin), name: s.name, pickup: data.pickup_location.name });
    packages.push({ status: 'Success', client: 'RASOI-MOCK', sort_code: `${cityOf(s.pin)[1]}/HYP`, waybill, refnum: s.order, payment: s.payment_mode, cod_amount: s.payment_mode === 'COD' ? Number(s.total_amount || 0) : 0, serviceable: true, remarks: [''] });
  }
  const good = packages.filter((p) => p.status === 'Success').length;
  return ok({ success: good === packages.length, package_count: packages.length, packages, upload_wbn: `UPL${Date.now()}`, rmk: good === packages.length ? '' : 'One or more packages failed; see packages[].remarks', prepaid_count: good, cod_count: 0 });
}

async function pickup(a) {
  for (const k of ['pickup_location', 'pickup_date', 'pickup_time', 'expected_package_count']) if (!a[k]) return fail(400, 'missing_param', `${k} is required`);
  const hour = Number(String(a.pickup_time).slice(0, 2));
  if (/NORIDER/i.test(a.pickup_location) || Number.isNaN(hour) || hour < 7 || hour >= 21) {
    return { status: 400, body: { success: false, pr_exist: false, error: { code: 'no_pickup_capacity', message: 'No pickup capacity (no rider) available for the requested slot' } } };
  }
  return ok({ success: true, pickup_id: 100000 + (hashInt(a.pickup_location + a.pickup_date + a.pickup_time) % 900000), pickup_location_name: a.pickup_location, pickup_date: a.pickup_date, pickup_time: a.pickup_time, expected_package_count: Number(a.expected_package_count), incoming_center_name: 'Hyperlocal Hub (mock)', client_name: 'RASOI-MOCK' });
}

async function track({ waybill }) {
  const p = parseWaybill(waybill);
  if (!p) return { status: 200, body: { Success: false, Error: 'No such waybill or Order Id found', rmk: 'Data does not exist for provided Waybill(s)' } };
  const meta = (await store.get(`dlv:wb:${waybill}`)) || {};
  const total = BASE_MIN * (p.scenario === 1 ? 2 : 1);
  const el = (Date.now() - p.createdMs) / 60000;
  const at = (frac) => iso(p.createdMs + total * frac * 60000);
  const steps = [
    [0, 'Manifested', 'UD', 'Shipment details manifested'],
    [0.12, 'In Transit', 'UD', 'Picked up from store'],
    [0.5, 'Dispatched', 'UD', 'Out for delivery'],
    [1, p.scenario === 2 ? 'Undelivered' : 'Delivered', p.scenario === 2 ? 'UD' : 'DL', p.scenario === 2 ? 'Consignee unavailable' : 'Delivered to consignee'],
  ];
  let scans = steps.filter(([f]) => el >= total * f);
  if (await store.get(`dlv:cancel:${waybill}`)) scans = [steps[0], [0, 'Cancelled', 'CN', 'Shipment cancelled by client']];
  const cur = scans[scans.length - 1];
  const dest = cityOf(meta.pin || '')[0];
  return ok({ ShipmentData: [{ Shipment: {
    AWB: String(waybill), ReferenceNo: meta.order || null, Consignee: { Name: meta.name || null, PinCode: meta.pin || null }, Origin: meta.pickup || null, Destination: dest,
    PickUpDate: at(0.12), ExpectedDeliveryDate: at(1), DeliveryDate: cur[1] === 'Delivered' ? at(1) : null,
    Status: { Status: cur[1], StatusType: cur[2], StatusDateTime: cur[1] === 'Cancelled' ? iso(Date.now()) : at(cur[0]), StatusLocation: dest, Instructions: cur[3] },
    Scans: scans.map(([f, s, t, ins]) => ({ ScanDetail: { Scan: s, ScanType: t, ScanDateTime: at(f), Instructions: ins } })),
  } }] });
}

async function cancel({ waybill, cancellation }) {
  if (String(cancellation) !== 'true') return fail(400, 'invalid_param', 'cancellation must be "true"');
  const p = parseWaybill(waybill);
  if (!p) return { status: 200, body: { status: false, waybill: String(waybill || ''), error: 'No such waybill found' } };
  const t = await track({ waybill });
  const st = t.body.ShipmentData[0].Shipment.Status.Status;
  if (st === 'Delivered') return { status: 200, body: { status: false, waybill: String(waybill), error: 'Shipment already delivered; cannot cancel' } };
  await store.set(`dlv:cancel:${waybill}`, true);
  return ok({ status: true, waybill: String(waybill), remark: 'Shipment has been cancelled.', order_id: t.body.ShipmentData[0].Shipment.ReferenceNo });
}

module.exports = { pincode, charges, createShipment, pickup, track, cancel };
