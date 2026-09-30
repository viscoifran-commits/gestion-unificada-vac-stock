# Gestión Unificada VAC + STOCK — Netlify

Esta carpeta contiene la versión preparada para publicar en Netlify con almacenamiento compartido entre computadoras.

## Estructura
- `index.html`: aplicación VAC + STOCK, con la base STOCK incorporada.
- `netlify/functions/auth.mjs`: autenticación remota y sesiones.
- `netlify/functions/data.mjs`: guardado/carga remota de VAC y STOCK mediante Netlify Blobs.
- `netlify.toml`: configuración de Netlify.
- `package.json`: dependencia de Netlify Blobs.

## Publicación recomendada
1. Subí esta carpeta a un repositorio de GitHub.
2. En Netlify: Add new project → Import an existing project → elegí el repositorio.
3. No hace falta agregar una base de datos externa.
4. Netlify instalará la dependencia de `package.json` y publicará las Functions.
5. Abrí la URL de Netlify.

## Importante
- No sirve simplemente abrir `index.html` con doble clic si querés almacenamiento compartido: las Functions de Netlify deben estar publicadas.
- La primera vez que se use `VISCOMI` o `FLORES`, se crea la contraseña en el servidor.
- VISCOMI conserva el rol de administrador y puede restablecer la clave de FLORES.
- Los datos se guardan en Netlify Blobs y quedan disponibles para los distintos equipos que entren al mismo sitio.
- Si dos personas modifican exactamente los mismos datos al mismo tiempo, el último guardado completo puede reemplazar al anterior. Para un uso con edición simultánea intensiva conviene migrar el stock a una base de datos relacional.

## Base inicial
La versión entregada parte de la base STOCK incorporada en el archivo HTML actual.
