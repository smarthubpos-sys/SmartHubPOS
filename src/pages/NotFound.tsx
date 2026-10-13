import { Link } from "react-router-dom";
import { tr } from "@/lib/i18n.ts";
export default function NotFound(){return <main className="min-h-screen grid place-items-center p-6"><div className="text-center"><h1 className="text-3xl font-bold">{tr("Ukurasa haujapatikana")}</h1><p className="my-3 text-muted-foreground">{tr("Kiungo ulichofungua hakipo.")}</p><Link className="underline" to="/">{tr("Rudi mwanzo")}</Link></div></main>}
