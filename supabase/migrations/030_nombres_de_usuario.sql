begin;
alter table public.perfiles add column nombre_usuario text unique
  check(nombre_usuario is null or nombre_usuario ~ '^[a-z0-9][a-z0-9_.]{2,29}$');

create function public.actualizar_nombre_usuario(p_nombre_usuario text) returns void
language plpgsql security definer set search_path = '' as $$
declare nombre_ text:=lower(trim(p_nombre_usuario));
begin
 if auth.uid() is null or not exists(select 1 from public.perfiles where id=auth.uid()) then
   raise exception 'Iniciá sesión para editar tu cuenta.';
 end if;
 if nombre_ is null or nombre_ !~ '^[a-z0-9][a-z0-9_.]{2,29}$' then
   raise exception 'Usá entre 3 y 30 caracteres: letras sin tildes, números, punto o guion bajo. Empezá con una letra o número.';
 end if;
 update public.perfiles set nombre_usuario=nombre_,nombre=nombre_ where id=auth.uid();
exception when unique_violation then
 raise exception 'Ese nombre de usuario ya está en uso.';
end;
$$;
revoke all on function public.actualizar_nombre_usuario(text) from public,anon,authenticated;
grant execute on function public.actualizar_nombre_usuario(text) to authenticated;
notify pgrst, 'reload schema';
commit;
