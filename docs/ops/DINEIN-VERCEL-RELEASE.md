# Dine-in Retail / Menu QR — manual Vercel bootstrap (20/10/2026)

Related EPIC: #241. **These are infrastructure shells only; NO Retail/Menu UI has been deployed.**

## Vercel project inventory (verified by provider)
| Target | Vercel project | Project ID | Root | Custom domain |
| --- | --- | --- | --- | --- |
| Retail staff POS | `sichuan-hotpot-retail` | `prj_Jpf6VJh61oUVQK9Gy1iJUKEqEFdi` | `apps/retail` | `retail.bepsi.click` |
| Guest QR menu | `sichuan-hotpot-menu` | `prj_c5iMwXob29KVWiJev6MVQ9YIhVra` | `apps/menu` | `menu.bepsi.click` |

Vercel account/team identifier: `team_y62wm4NHABOjKc1wyNmGmJgR`. Both projects were **created without Git repo integration**, with preview deployments disabled. Main `vercel.json` and each new app `vercel.json` permanently enforce `git.deploymentEnabled=false`. **Do not connect Git or enable automatic deployments.**

## 1. One-time prerequisites (not done by GitHub code)
1. In GitHub repo **Settings > Environments**, create `production-retail-pwa` and `production-menu-pwa`. For each Environment configure:
   - Secret: `VERCEL_TOKEN` (authorized for the correct Vercel team; never paste it into comments/code).
   - Variable: `VERCEL_ORG_ID` = `team_y62wm4NHABOjKc1wyNmGmJgR`.
   - Variable: `VERCEL_PROJECT_ID` = exact ID in table above for each app.
   - For manual `workflow_dispatch`, `HOTPOT_RELEASES_ENABLED=true` if that command is used. Issue #3 owner comments already provide manual release intent as with existing Admin/Customer PWA.
   - Owner must follow existing environment reviewer policy; workflow cannot bypass deployment-protection approvals.
2. In Vercel, configure project **Production Environment Variable** `EXPO_PUBLIC_API_BASE_URL` to the existing working public HTTPS API origin (not a guessed IP, not an URL with a path). App must be coded to use it before first deploy.
3. In DNS provider for `bepsi.click`, make `retail` and `menu` subdomains point to Vercel as instructed in project Domain UI (typically CNAME `cname.vercel-dns.com`). Vercel reported domain ownership **pending verification** and requested TXT records at `_vercel.bepsi.click`; inspect Vercel before writing TXT because the challenge may change.
4. Ensure production API CORS permits **https://retail.bepsi.click** and **https://menu.bepsi.click** before first publish, and public menu/QR endpoints are released before Menu deployment. Never weaken staff auth or grant QR guest admin rights.
5. Bootstrap `apps/retail` and `apps/menu` in separate implementation PRs before attempting release. They must each have `package.json` with `lint`, `typecheck`, `test`, `build`, and Expo Web `dist/index.html`, and use the monorepo lockfile. **Current infrastructure PR intentionally does not add placeholders that look like functional apps.**

## 2. Exact manual owner comments
Comment on **Issue #3 only**, by repository owner `meyecarpenter23842`, with **exactly one command**:

- `/deploy-hotpot-retail` → only Retail PWA
- `/deploy-hotpot-menu` → only Menu QR PWA

Workflow: `.github/workflows/vercel-dinein-release-manual.yml`. It verifies current protected `main` SHA; checks no Git integration; validates branch, project ID, team scope, environment, API health/CORS; lints/tests target; pulls app's Vercel production public config before Expo build; produces exact prebuilt Vercel static output + canonical redirects; manual `vercel deploy --prebuilt --prod`; smoke-checks canonical hostname. Any failed step stops the release. No migration or VPS deploy is implied.

The workflow also supports protected `workflow_dispatch` with app, exact current main SHA and confirm `DEPLOY_PWA`.

**Do NOT post these commands until DNS, environments, backend contract, CI and each actual frontend are ready.** No push/merge triggers this deploy workflow, and no command on random issues / from other users may release.

## 3. Smoke/rollback
- Check two Vercel projects remain unlinked from Git and have correct root path.
- Confirm DNS verified; HTTPS works. Test Retail staff login and QR menu anonymous entry only after apps/API are implemented.
- Confirm Vercel production env, Android/iPhone Safari, session/cookie behavior, role/branch restrictions, pending QR approval and kitchen separation.
- Record target, main SHA, GitHub run, deployment ID and verification results. Rollback via explicit owner-requested prior verified Vercel deployment (never Git auto deploy).
- Do not treat Vercel project/domain creation as a deployed app.
