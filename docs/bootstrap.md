# Nueva app en 1 comando: `pnpm bootstrap`

`pnpm bootstrap` crea toda la infraestructura de una app nueva a partir de este starter kit:

| Qué | Cómo |
|---|---|
| Repo de GitHub (privado por defecto) | `gh repo create` + push |
| Base de datos Postgres en Neon (connection string *pooled*, `sslmode=require`) | `neonctl` |
| Proyecto en Vercel conectado al repo | `vercel project add` / `link` / `git connect` |
| Vercel Blob (subida de archivos) | `vercel blob create-store` |
| Proyecto de Google Cloud + login con Google | `gcloud` + 2 pasos guiados en la consola (ver abajo) |
| `.env` local con todos los valores y un `BETTER_AUTH_SECRET` nuevo | automático |
| Variables de entorno en Vercel (production / preview / development) | `vercel env add` |
| Migraciones en Neon | `pnpm db:migrate` |
| Primer deploy a producción | `vercel deploy --prod` |

```bash
git clone https://github.com/Julianchoo/agentic-coding-starter-kit mi-app
cd mi-app && pnpm i && pnpm bootstrap mi-app
```

---

## 1. Requisitos (una sola vez por PC)

Necesitás Node 20+, pnpm y estas CLIs instaladas **y con sesión iniciada**. El script verifica todo al arrancar y, si falta algo, te muestra el comando exacto para tu sistema operativo.

| CLI | Windows | macOS | Linux | Login |
|---|---|---|---|---|
| git | `winget install --id Git.Git -e` | `xcode-select --install` | `sudo apt install git` | — |
| GitHub (`gh`) | `winget install --id GitHub.cli -e` | `brew install gh` | `sudo apt install gh` ([otras distros](https://github.com/cli/cli/blob/trunk/docs/install_linux.md)) | `gh auth login` |
| Neon (`neonctl`) | `npm i -g neonctl` | `brew install neonctl` | `npm i -g neonctl` | `neonctl auth` |
| Vercel (`vercel`) | `npm i -g vercel@latest` | `npm i -g vercel@latest` | `npm i -g vercel@latest` | `vercel login` |
| Google Cloud (`gcloud`) | `winget install --id Google.CloudSDK -e` | `brew install --cask google-cloud-sdk` | [instalador oficial](https://cloud.google.com/sdk/docs/install) | `gcloud auth login` |

Notas:

- `gh auth login`: elegí HTTPS y aceptá "Authenticate Git with your GitHub credentials" para que `git push` funcione (o corré `gh auth setup-git`).
- Vercel: el script usa tu equipo (*scope*) actual. Si tenés varios, elegilo antes con `vercel switch`.
- Neon: si tu cuenta tiene más de una organización, pasá `--neon-org <org-id>` (lo ves con `neonctl orgs list`).
- `gcloud` no es necesario si usás `--skip-google`.
- En Windows, después de instalar con `winget` o `npm i -g`, abrí una terminal nueva para que se actualice el `PATH`.

## 2. Uso

```bash
pnpm bootstrap <nombre-app> [opciones]
```

El nombre se convierte a *slug* (`"Mi App Ñandú"` → `mi-app-nandu`) y se usa para el repo de GitHub, el proyecto de Neon, el de Vercel y el `name` de `package.json`. Si no lo pasás, el script lo pregunta.

| Opción | Qué hace |
|---|---|
| `--private` / `--public` | Visibilidad del repo de GitHub (por defecto `--private`) |
| `--region <id>` | Región de Neon (por defecto `aws-sa-east-1`, São Paulo). El Blob store se crea en la región de Vercel más cercana (`gru1` para São Paulo) |
| `--neon-org <id>` | Organización de Neon donde crear el proyecto |
| `--prod-url <url>` | URL de producción si no es `https://<app>.vercel.app` (por ejemplo, un dominio propio) |
| `--google-project <id>` | Reusar un proyecto de Google Cloud existente en vez de crear uno |
| `--skip-google` | No configurar login con Google |
| `--skip-blob` | No crear Vercel Blob |
| `--skip-deploy` | No desplegar al final |
| `--dry-run` | Muestra cada comando que correría, sin ejecutar nada ni escribir archivos |
| `--yes`, `-y` | Sin confirmaciones (acepta la URL de producción detectada) |
| `--help` | Ayuda |

Para uso no interactivo (CI, scripts) podés pasar las credenciales de Google por variables de entorno:

```bash
BOOTSTRAP_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com \
BOOTSTRAP_GOOGLE_CLIENT_SECRET=GOCSPX-xxx \
BOOTSTRAP_NO_BROWSER=1 \
pnpm bootstrap mi-app --yes
```

Tip: probá primero con `pnpm bootstrap mi-app --dry-run` para ver exactamente qué va a pasar.

## 3. Qué hace, paso a paso

1. **Verificación**: CLIs instaladas y con sesión iniciada, y que estás en la raíz del repo.
2. **Identidad**: pone el slug como `name` en `package.json`.
3. **GitHub**: si `origin` apunta al starter kit, lo renombra a `upstream`. Commitea los cambios (`chore: bootstrap <app>`) y crea el repo con `gh repo create <app> --private --source . --remote origin --push`. Si el repo ya existe, lo reutiliza.
4. **Neon**: crea el proyecto (o reutiliza uno con el mismo nombre) y guarda en `.env` la connection string *pooled* con `sslmode=require`.
5. **Vercel**: crea el proyecto, lo vincula (`.vercel/`), lo conecta al repo de GitHub y detecta la URL de producción (por defecto `https://<app>.vercel.app`; sin `--yes` te pide confirmarla).
6. **Blob**: crea un store público `<app>-blob`, lo conecta a todos los entornos del proyecto y copia `BLOB_READ_WRITE_TOKEN` a `.env`.
7. **Google**: crea el proyecto de Google Cloud (`<app>-xxxxxx`) y te guía por los 2 pasos manuales (ver abajo).
8. **Secretos**: genera `BETTER_AUTH_SECRET` (o reutiliza el que ya tengas) y pone `NEXT_PUBLIC_APP_URL=http://localhost:3000` en `.env`.
9. **Variables en Vercel**: `POSTGRES_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en production, preview y development. `NEXT_PUBLIC_APP_URL` y `BETTER_AUTH_URL` (= URL de producción) solo en production. Los valores van por stdin, nunca en la línea de comandos.
10. **Migraciones**: `pnpm db:migrate` contra Neon.
11. **Deploy**: `vercel deploy --prod --yes` (el archivo `.vercelignore` evita subir `.env`).
12. **Resumen**: lo que se creó y lo que queda pendiente.

## 4. Lo que sigue siendo manual

### Cliente OAuth de Google

Google no tiene una API pública para crear clientes OAuth de "Sign in with Google", así que el script abre la consola en el navegador y te muestra los valores que tenés que pegar:

1. **Branding (pantalla de consentimiento)**: `https://console.cloud.google.com/auth/branding?project=<id>`. Completá el nombre de la app y tu email, elegí *Audience: External* y creá.
2. **Crear cliente**: `https://console.cloud.google.com/auth/clients/create?project=<id>`
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:3000` y `https://<app>.vercel.app`
   - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` y `https://<app>.vercel.app/api/auth/callback/google`
3. Copiá el **Client ID** y el **Client Secret** y pegalos cuando el script los pida (el secret no se muestra en pantalla).

La app de Google queda en modo *Testing* (solo entran los usuarios de prueba que agregues). Para abrirla a todos, publicala en **Google Auth Platform → Audience → Publish app**.

El botón "Continue with Google" aparece en `/login` y `/register` solo cuando `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` están definidos. Sin ellos, la app funciona solo con email y contraseña.

### Otras claves

- `OPENROUTER_API_KEY` (chat con IA): agregala a `.env` y a Vercel con `vercel env add OPENROUTER_API_KEY production`.
- `POLAR_*` (pagos), si los usás.
- Dominio propio: agregalo en Vercel, sumá las URLs nuevas al cliente OAuth de Google y actualizá `NEXT_PUBLIC_APP_URL` y `BETTER_AUTH_URL` en Vercel.

## 5. Volver a correr / retomar

El progreso se guarda en `.bootstrap.json` (en `.gitignore`). Ese archivo solo guarda IDs y URLs, **nunca secretos**; los secretos viven únicamente en `.env` y en Vercel.

- Si un paso falla, el script muestra qué comando falló y el error. Arreglá el problema y corré `pnpm bootstrap` de nuevo: los pasos que ya terminaron se saltean.
- Si borrás `.env`, al volver a correr se recuperan la connection string de Neon y el token de Blob. Las credenciales de Google se vuelven a pedir.
- Para rehacer un paso, borrá su entrada en `completed` dentro de `.bootstrap.json` (por ejemplo `"vercel-env"` para volver a subir las variables a Vercel).
- Para empezar de cero, borrá `.bootstrap.json`. Ojo: los recursos ya creados en GitHub, Neon, Vercel y Google **no** se borran; el script reutiliza los que encuentre con el mismo nombre (repo, proyecto de Neon, proyecto de Vercel, Blob store).
- Si omitiste algo con `--skip-*`, corré el comando de nuevo sin esa opción y se hace solo lo que falta.

Nota: al crear el Blob store, Vercel también escribe un `.env.local` con variables de desarrollo (por ejemplo `BLOB_READ_WRITE_TOKEN`). Next.js le da prioridad sobre `.env`. Es inofensivo, pero tenelo en cuenta si cambiás valores a mano.

## 6. Mantener el fork actualizado con el starter kit original

Tu fork (`Julianchoo/agentic-coding-starter-kit`) viene de `leonvanzyl/agentic-coding-starter-kit`.

**Actualizar el fork** con los cambios del original:

```bash
gh repo sync Julianchoo/agentic-coding-starter-kit --source leonvanzyl/agentic-coding-starter-kit
```

O a mano, desde un clon del fork:

```bash
git remote add original https://github.com/leonvanzyl/agentic-coding-starter-kit
git fetch original
git merge original/main   # resolvé conflictos si los hay
git push origin main
```

**Traer mejoras del fork a una app ya creada**: `pnpm bootstrap` deja el fork como remote `upstream`:

```bash
git fetch upstream
git merge upstream/main
```

## 7. Versiones probadas

La sintaxis de las CLIs se verificó con `vercel` 60.0.1 y `neonctl` 6.0.0. `vercel env add --force` necesita una versión reciente de Vercel CLI: si tu versión no lo reconoce, actualizala con `npm i -g vercel@latest`.
