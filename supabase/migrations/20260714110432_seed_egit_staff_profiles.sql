insert into public.technicians (
  id,
  display_name,
  sdp_technician_id,
  sdp_technician_name,
  outlook_email,
  store_location,
  active,
  default_calendar_id
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'Simeon',
    null,
    null,
    'simeon@egit.com.au',
    'Bairnsdale',
    true,
    null
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Matt',
    null,
    null,
    'mattd@egit.com.au',
    'Sale',
    true,
    null
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'Jervy',
    null,
    null,
    'jervy@egit.com.au',
    'Bairnsdale',
    true,
    null
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'Riley',
    null,
    null,
    'riley@egit.com.au',
    'Bairnsdale',
    true,
    null
  )
on conflict (outlook_email) do update set
  display_name = excluded.display_name,
  store_location = excluded.store_location,
  active = excluded.active,
  updated_at = now();

insert into public.staff_profiles (
  id,
  display_name,
  role,
  base_office,
  zoho_email,
  outlook_email,
  outlook_user_principal_name,
  msp_central_email,
  msp_central_technician_id,
  msp_central_technician_name,
  active,
  calendar_enabled,
  dispatch_enabled
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    'Simeon',
    'admin',
    'Bairnsdale',
    'simeon@egit.com.au',
    'simeon@egit.com.au',
    'simeon@egit.com.au',
    'simeon@egit.com.au',
    null,
    null,
    true,
    true,
    true
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Matt',
    'technician',
    'Sale',
    'mattd@egit.com.au',
    'mattd@egit.com.au',
    'mattd@egit.com.au',
    'mattd@egit.com.au',
    null,
    null,
    true,
    true,
    true
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'Jervy',
    'technician',
    'Bairnsdale',
    'jervy@egit.com.au',
    'jervy@egit.com.au',
    'jervy@egit.com.au',
    'jervy@egit.com.au',
    null,
    null,
    true,
    true,
    true
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    'Riley',
    'technician',
    'Bairnsdale',
    'riley@egit.com.au',
    'riley@egit.com.au',
    'riley@egit.com.au',
    'riley@egit.com.au',
    null,
    null,
    true,
    true,
    true
  )
on conflict (zoho_email) do update set
  display_name = excluded.display_name,
  role = excluded.role,
  base_office = excluded.base_office,
  outlook_email = excluded.outlook_email,
  outlook_user_principal_name = excluded.outlook_user_principal_name,
  msp_central_email = excluded.msp_central_email,
  msp_central_technician_id = excluded.msp_central_technician_id,
  msp_central_technician_name = excluded.msp_central_technician_name,
  active = excluded.active,
  calendar_enabled = excluded.calendar_enabled,
  dispatch_enabled = excluded.dispatch_enabled,
  updated_at = now();
