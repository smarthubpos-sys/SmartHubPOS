import { ArrowLeft, Construction } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { tr } from "@/lib/i18n.ts";

type Props = {
  module: string;
  onBack: () => void;
};

export default function ComingSoon({ module, onBack }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
      <div className="p-4 bg-accent/10 rounded-full">
        <Construction className="w-12 h-12 text-accent" />
      </div>
      <div className="text-center">
        <h3 className="text-xl font-semibold text-foreground">{tr("Coming in Next Milestone")}</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          
          {tr("This")} {module}  {tr("feature will be built in the next development phase.")}
        </p>
      </div>
      <Button variant="secondary" onClick={onBack} className="cursor-pointer">
        <ArrowLeft className="w-4 h-4 mr-2" />
        
        {tr("Back to")} {module}  {tr("Menu")}
      </Button>
    </div>
  );
}
