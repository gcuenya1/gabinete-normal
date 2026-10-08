# Reservas de Gabinete

Sistema web para reservar recursos del gabinete (TV, proyector, notebooks, laboratorio, instrumentos…).
Reemplaza al Google Form: los docentes ven en tiempo real qué está libre y la reserva queda confirmada al instante, sin choques de horario.

- **Docentes** → `https://TU-SITIO.netlify.app/` (sin login)
- **Gabinete / Admin IT** → `https://TU-SITIO.netlify.app/admin`

## Roles

| Rol | Cómo entra | Qué puede hacer |
|---|---|---|
| **Docente** | Sin login | Reservar (día → horario → recursos → datos, con **DNI**), ver la ocupación del día (solo libre/ocupado, sin nombres) y, con su DNI, ver/cancelar **solo sus** reservas y cargar el reporte de sala. El navegador recuerda sus datos. |
| **Administrador** (gabinete) | Usuario creado por Admin IT | Agenda del día, marcar *entregado / devuelto*, crear/editar/cancelar reservas (sin restricción de 24 h), notas internas, buscar y exportar a Excel (CSV), gestionar recursos. |
| **Admin IT** | Usuario `it` + contraseña de la variable `IT_PASSWORD` | Todo lo anterior + crear usuarios del gabinete y cambiar la configuración (anticipación mínima, días habilitados, módulos horarios, aviso). |

## Cancelaciones
- Cuando el gabinete cancela una reserva, **tiene que escribir el motivo** (hay motivos rápidos para elegir).
- El docente lo ve en **Mis reservas → Canceladas** (con fecha, hora y motivo) y, al entrar a la página, le aparece un aviso rojo la primera vez. Desde ahí puede **"Reservar otra vez"** con los mismos datos.
- Las reservas solo se pueden eliminar después de cancelarlas, para que el docente siempre se entere.

## Reporte de uso (Sala de informática)
Los recursos marcados con **"Pedir reporte de uso"** (la Sala de informática viene así) le piden al docente un reporte después de la clase:
materia, tema, herramientas/software, **alumno por número de máquina**, cómo encontró la sala y novedades al salir (con máquinas con fallas).

- Lo carga **únicamente el docente que reservó**, desde **Mis reservas** ingresando su DNI (sin puntos). Puede adelantarlo (ej. lista de alumnos) y completarlo al terminar la clase. Si tiene reportes pendientes, le aparece un aviso al entrar.
- Puede **pegar la lista de alumnos** (uno por línea, o `7 - Juan Pérez`) y la próxima vez que reserve para el mismo curso, la lista se carga sola.
- El gabinete ve cada reporte en el detalle de la reserva (solo lectura; puede imprimirlo), filtra por "reporte pendiente", busca por alumno o "máquina 12", y exporta **Reportes de sala (CSV)**: una fila por alumno/máquina, ideal para Excel.
- La vista pública de **Ocupación** solo muestra qué está ocupado y en qué horario: no muestra docente, curso, alumnos ni reportes.
- Reservas viejas sin DNI no aparecen en *Mis reservas*; el gabinete puede agregarles el DNI desde **Editar**.

## Deploy en Netlify (≈5 minutos)

> El "arrastrar y soltar" de Netlify **no** sirve: el sistema usa una Function. Usá GitHub o la CLI.

### Opción A — GitHub (recomendada)
1. Subí esta carpeta a un repositorio de GitHub.
2. En Netlify: **Add new site → Import an existing project → GitHub** → elegí el repo.
   No hace falta tocar nada: `netlify.toml` ya define la carpeta `public` y las funciones.
3. **Site configuration → Environment variables** → agregá:
   - `IT_PASSWORD` → tu contraseña de Admin IT (**obligatoria**)
   - `AUTH_SECRET` → un texto largo y aleatorio (recomendado; firma las sesiones)
   - `IT_USER` → (opcional) otro nombre de usuario en lugar de `it`
4. **Deploys → Trigger deploy**. Listo. La base de datos (Netlify Blobs) se crea sola.

### Opción B — Netlify CLI
```bash
npm install
npx netlify-cli login
npx netlify-cli init            # crea/vincula el sitio
npx netlify-cli env:set IT_PASSWORD "tu-clave"
npx netlify-cli env:set AUTH_SECRET "$(openssl rand -hex 32)"
npx netlify-cli deploy --prod
```

## Primeros pasos después del deploy
1. Entrá a `/admin` con `it` y tu `IT_PASSWORD`.
2. **Configuración**: nombre de la escuela, módulos horarios reales, días y anticipación.
3. **Recursos**: ajustá la lista (vienen 6 de ejemplo). *Cantidad* = unidades que se pueden prestar a la vez (ej. 10 notebooks).
4. **Usuarios**: creá las cuentas del personal del gabinete.
5. Compartí el link principal con los docentes (o reemplazá el link del Form).

## Probar en la compu (sin Netlify)
```bash
npm install
npm run local        # http://localhost:8888  — Admin IT: it / admin123
```
Los datos de prueba quedan en la carpeta `.data/`.

## Estructura
```
public/index.html         Vista de docentes
public/admin.html         Panel del gabinete / Admin IT
public/common.js, styles.css
netlify/functions/api.mjs API (/api/*) + almacenamiento en Netlify Blobs
dev-server.mjs            Servidor local de prueba
```

## Notas
- Zona horaria fija Argentina (UTC-3). Horario de reservas por defecto: 07:00 a 23:00 (se cambia en Configuración).
- Controla superposición por recurso y cantidad; dos docentes no pueden reservar lo mismo a la vez.
- Para algo urgente (menos de 24 h), el gabinete lo carga desde el panel.
- Cambiar `AUTH_SECRET` cierra todas las sesiones abiertas.
