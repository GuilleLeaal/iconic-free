-- Solo psql, como propietario. Proporcionar ADMIN_UUID y ADMIN_EMAIL explícitos.
-- Falla si no existen, no coinciden o ya se ejecutó el bootstrap.
\set ON_ERROR_STOP on
begin;
select private.instalar_iconic(:'ADMIN_UUID'::uuid, :'ADMIN_EMAIL') as competencia_iconic;
commit;
