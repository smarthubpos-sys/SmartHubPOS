/* Texts for: editing the date of an invoice / Selling Point bill, removing a product while editing, and the sales report "View Report" flow. */
export const EDITDATE_DICT: Record<string, { sw: string; en: string }> = {
  "Tarehe ya invoice": { sw: "Tarehe ya invoice", en: "Invoice date" },
  "Chagua tarehe ya invoice.": { sw: "Chagua tarehe ya invoice.", en: "Choose the invoice date." },
  "Chagua tarehe ya bili.": { sw: "Chagua tarehe ya bili.", en: "Choose the bill date." },
  "Tarehe ya invoice itabadilika kutoka {0} kwenda {1}; mauzo, stock na hesabu vitahamia tarehe mpya.": {
    sw: "Tarehe ya invoice itabadilika kutoka {0} kwenda {1}; mauzo, stock na hesabu vitahamia tarehe mpya.",
    en: "The invoice date will change from {0} to {1}; the sale, stock and accounts move to the new date.",
  },
  "Tarehe ya bili itabadilika kutoka {0} kwenda {1}; mauzo yataonekana kwenye ripoti za tarehe mpya.": {
    sw: "Tarehe ya bili itabadilika kutoka {0} kwenda {1}; mauzo yataonekana kwenye ripoti za tarehe mpya.",
    en: "The bill date will change from {0} to {1}; the sale will appear in the reports of the new date.",
  },
  "Bili lazima iwe na angalau bidhaa moja. Kama unataka kuiondoa kabisa, tumia Delete / Cancel.": {
    sw: "Bili lazima iwe na angalau bidhaa moja. Kama unataka kuiondoa kabisa, tumia Delete / Cancel.",
    en: "A bill must keep at least one product. To remove it completely, use Delete / Cancel.",
  },
  "Bili lazima ibaki na angalau bidhaa moja.": { sw: "Bili lazima ibaki na angalau bidhaa moja.", en: "A bill must keep at least one product." },
  "Invoice lazima ibaki na angalau bidhaa moja. Kama unataka kuiondoa kabisa, ifute (Cancel).": {
    sw: "Invoice lazima ibaki na angalau bidhaa moja. Kama unataka kuiondoa kabisa, ifute (Cancel).",
    en: "An invoice must keep at least one product. To remove it completely, cancel it.",
  },
  "Tarehe ya invoice haiwezi kuwa ya baadaye.": { sw: "Tarehe ya invoice haiwezi kuwa ya baadaye.", en: "The invoice date cannot be in the future." },
  "Tarehe ya bili haiwezi kuwa ya baadaye.": { sw: "Tarehe ya bili haiwezi kuwa ya baadaye.", en: "The bill date cannot be in the future." },
  "Tarehe ya bili si sahihi (tumia mwaka-mwezi-siku, mfano 2026-10-15).": {
    sw: "Tarehe ya bili si sahihi (tumia mwaka-mwezi-siku, mfano 2026-10-15).",
    en: "The bill date is not valid (use year-month-day, e.g. 2026-10-15).",
  },
  "Tarehe ya invoice si sahihi (tumia mwaka-mwezi-siku, mfano 2026-10-15).": {
    sw: "Tarehe ya invoice si sahihi (tumia mwaka-mwezi-siku, mfano 2026-10-15).",
    en: "The invoice date is not valid (use year-month-day, e.g. 2026-10-15).",
  },
  "View Report": { sw: "Angalia Ripoti", en: "View Report" },
  "Hide Report": { sw: "Ficha Ripoti", en: "Hide Report" },
  "Show Report": { sw: "Onyesha Ripoti", en: "Show Report" },
  "Export Excel": { sw: "Pakua Excel", en: "Export Excel" },
  "Tuma kwa Email": { sw: "Tuma kwa Email", en: "Send by Email" },
  "Kipindi: {0} hadi {1}": { sw: "Kipindi: {0} hadi {1}", en: "Period: {0} to {1}" },
};
