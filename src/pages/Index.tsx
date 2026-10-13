import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import { SignInButton } from "@/components/ui/signin.tsx";
import { tr } from "@/lib/i18n.ts";

export default function Index() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate("/dashboard", { replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  if (isAuthenticated) {
    return <main className="min-h-screen bg-gradient-to-br from-[#0b4ea2] via-[#0a63c7] to-[#0756ad]" aria-hidden="true" />;
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_8%,rgba(96,165,250,0.32),transparent_34%),linear-gradient(145deg,#0b4ea2_0%,#0a63c7_48%,#0756ad_100%)] px-4 py-5 text-slate-100">
      <section className="relative w-full max-w-[390px] rounded-[24px] border border-white/10 bg-[linear-gradient(155deg,#082b63_0%,#061f4b_52%,#051a3c_100%)] px-6 py-6 shadow-[0_25px_65px_rgba(4,31,75,0.32),inset_0_1px_0_rgba(255,255,255,0.08)] sm:px-[25px] sm:py-7">
        <header className="mb-5 text-center">
          <div className="mx-auto mb-2 flex h-[68px] w-[68px] items-center justify-center overflow-hidden rounded-[18px] border border-white/10 bg-white/5 p-1.5 shadow-lg shadow-black/10">
            <img src="/assets/smarthub-logo.webp.png" alt="SmartHub POS" className="h-full w-full rounded-xl object-contain" />
          </div>
          <h1 className="text-[23px] font-extrabold leading-tight tracking-wide text-white">SMARTHUB POS</h1>
          <p className="mt-1 text-[11px] text-[#9eb1d3]">Your Priority Is Our Concern</p>
        </header>

        <div className="mb-4">
          <h2 className="text-lg font-bold text-white">{tr("Karibu tena")}</h2>
        </div>

        <SignInButton />

        <p className="mt-5 text-center text-[10px] leading-4 text-[#6f82a7]">SmartHub POS Enterprise · © 2026</p>
      </section>
    </main>
  );
}
