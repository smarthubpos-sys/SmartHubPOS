/* Texts for: moving night sales (after midnight) and their cash to the real business day. */
export const DAYMOVE_DICT: Record<string, { sw: string; en: string }> = {
  "Mauzo ya usiku (baada ya saa 6 usiku)? Yarudishe siku iliyopita": { sw: "Mauzo ya usiku (baada ya saa 6 usiku)? Yarudishe siku iliyopita", en: "Night sales (after midnight)? Move them back to the previous day" },
  "Bili zilizotiki zitahamia siku utakayochagua, na fedha zake (cash, mobile, bank) zitahesabiwa siku hiyo hiyo kwenye ripoti zote.": { sw: "Bili zilizotiki zitahamia siku utakayochagua, na fedha zake (cash, mobile, bank) zitahesabiwa siku hiyo hiyo kwenye ripoti zote.", en: "The ticked bills move to the day you choose, and their money (cash, mobile, bank) is counted on that same day in all reports." },
  "Hamisha bili zilizotiki": { sw: "Hamisha bili zilizotiki", en: "Move ticked bills" },
  "Hamisha siku": { sw: "Hamisha siku", en: "Move day" },
  "Hamisha na fedha": { sw: "Hamisha na fedha", en: "Move with money" },
  "Ghairi": { sw: "Ghairi", en: "Cancel" },
  "Bili {0} na risiti {1} zimehamia siku {2}. Fedha zimehamia pamoja nazo.": { sw: "Bili {0} na risiti {1} zimehamia siku {2}. Fedha zimehamia pamoja nazo.", en: "{0} bill(s) and {1} receipt(s) moved to {2}. The money moved with them." },
  "Imeshindikana kuhamisha siku. Hakuna kilichobadilishwa; jaribu tena.": { sw: "Imeshindikana kuhamisha siku. Hakuna kilichobadilishwa; jaribu tena.", en: "Could not move the day. Nothing was changed; try again." },
  "Cashier au meneja pekee ndiye anaweza kuhamisha siku ya mauzo.": { sw: "Cashier au meneja pekee ndiye anaweza kuhamisha siku ya mauzo.", en: "Only a cashier or manager can move the sales day." },
  "Siku ya mauzo haiwezi kuwa ya baadaye.": { sw: "Siku ya mauzo haiwezi kuwa ya baadaye.", en: "The sales day cannot be in the future." },
  "Chagua angalau bili moja.": { sw: "Chagua angalau bili moja.", en: "Choose at least one bill." },
  "Chagua bili zisizozidi 200 kwa mara moja.": { sw: "Chagua bili zisizozidi 200 kwa mara moja.", en: "Choose no more than 200 bills at a time." },
  "Bili iliyofutwa au ambayo haijatumwa haiwezi kuhamishwa.": { sw: "Bili iliyofutwa au ambayo haijatumwa haiwezi kuhamishwa.", en: "A cancelled bill, or one that was not sent, cannot be moved." },
  "Bili hii imeelekezwa kwa mteja kama deni; haiwezi kuhamishwa.": { sw: "Bili hii imeelekezwa kwa mteja kama deni; haiwezi kuhamishwa.", en: "This bill was assigned to a customer as debt; it cannot be moved." },
  "Siku ya bili hii ilishafungwa kwenye ripoti (Unda Ripoti ya Siku); haiwezi kuhamishwa.": { sw: "Siku ya bili hii ilishafungwa kwenye ripoti (Unda Ripoti ya Siku); haiwezi kuhamishwa.", en: "The day of this bill was already closed in a report (Create Day Report); it cannot be moved." },
};
