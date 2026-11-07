# Maintenance — kilichofanyika

| Skrini | Kinachofanya | Ruhusa |
|---|---|---|
| System Setup | stock control, negative stock, costing, format ya tarehe, footer ya risiti | maintenance.system (+company) |
| Company Information | jina, TIN, simu, email, anwani, website, logo | maintenance.company |
| Hardware Setup | printer, upana wa karatasi, scanner, cash drawer, **Test print** | maintenance.hardware |
| Currency Settings | code, symbol, decimals (na mfano) | maintenance.company |
| Tax Settings | kodi ya msingi, viwango vingine, tax-inclusive, bendera ya TRA | maintenance.tax |
| Document Numbering | prefix/tarakimu/namba inayofuata kwa nyaraka 8 | maintenance.numbering |
| Financial Period Settings | tengeneza vipindi 12, ongeza, close / reopen / lock / unlock, futa | maintenance.periods |
| Language Settings | Kiswahili / English kwa ofisi | maintenance.language |
| User Settings | ongeza mtumiaji (username+password), badilisha role/ofisi/branch, enable/disable, reset password | maintenance.users |
| User Security Settings | urefu wa password, **idle timeout inayotekelezwa**, kulazimisha kubadilisha password ya kwanza, badilisha password yangu | maintenance.security |
| Role Management | role za mfumo + custom, checkbox za permissions, reset | maintenance.roles (Super Admin) |
| Backup and Restore | pakua backup ya JSON (bila password hashes) | Super Admin |
| Audit Trail | kumbukumbu zenye kichujio/utafutaji (kila ofisi inaona zake) | maintenance.audit.view |
| Database Maintenance | ukaguzi wa afya ya data, idadi ya rekodi, unganisha rekodi zisizo na ofisi, futa audit logs za zamani | Super Admin |

## Mipaka (kwa uaminifu)
- **Restore ndani ya app haipo** kwa makusudi: IDs za Convex hubadilika na data ya kifedha ingeweza kuharibika. Tumia `npx convex export` / `npx convex import` (maelekezo yako kwenye skrini).
- **Re-index/optimize**: Convex hufanya hivyo yenyewe; skrini inafanya ukaguzi wa uadilifu badala yake.
- **Document Numbering**: mipangilio inahifadhiwa na prefix za invoice/purchase zinasawazishwa kwenye company settings, lakini moduli za Purchasing/Sales bado zinatumia mfuatano wao wa sasa hadi zibadilishwe kusoma `maintenance.getSettings`.
- **Language**: lugha inahifadhiwa; tafsiri kamili ya skrini zote bado haijafanyika.
- **Hardware**: browser huchagua printer halisi; jina la printer ni kumbukumbu. Hakuna dereva wa moja kwa moja wa cash drawer/serial.
- Moduli nyingine (Products, Purchasing n.k.) bado zinahitaji Super Admin achague ofisi/branch kama zamani; ni Suppliers na Maintenance tu vimerekebishwa kuruhusu Super Admin.
- Ruhusa za role mpya zinatumika kwenye Suppliers na Maintenance; moduli nyingine bado zinatumia ukaguzi wa "manager" (role ya custom yenye `system.manager` inapita).
- Sijaweza kuendesha Convex deployment halisi hapa: typecheck (app + convex), vitest (11 tests) na `vite build` zimepita, lakini jaribu kwenye deployment ya majaribio kwanza.
