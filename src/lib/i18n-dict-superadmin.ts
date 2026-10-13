/** Texts of the Super Admin business list and alerts (sw = Kiswahili, en = English). */
export const SUPERADMIN_DICT: Record<string, { sw: string; en: string }> = {
  "Tahadhari": { sw: "Tahadhari", en: "Alerts" },
  "Hakuna tahadhari. Kila kitu kiko sawa.": { sw: "Hakuna tahadhari. Kila kitu kiko sawa.", en: "No alerts. Everything looks fine." },
  "{0}: usajili uliisha tarehe {1}.": { sw: "{0}: usajili uliisha tarehe {1}.", en: "{0}: subscription ended on {1}." },
  "{0}: usajili unaisha baada ya siku {1} ({2}).": { sw: "{0}: usajili unaisha baada ya siku {1} ({2}).", en: "{0}: subscription ends in {1} day(s) ({2})." },
  "{0}: vitendo {1} vimeshindwa ndani ya saa 24 zilizopita.": { sw: "{0}: vitendo {1} vimeshindwa ndani ya saa 24 zilizopita.", en: "{0}: {1} action(s) failed in the last 24 hours." },
  "{0}: biashara imesimamishwa.": { sw: "{0}: biashara imesimamishwa.", en: "{0}: business is suspended." },
  "Kuna tahadhari {0} zinazohitaji kuangaliwa.": { sw: "Kuna tahadhari {0} zinazohitaji kuangaliwa.", en: "{0} alert(s) need your attention." },
  "Tafuta biashara…": { sw: "Tafuta biashara…", en: "Search business…" },
  "Hakuna biashara inayolingana.": { sw: "Hakuna biashara inayolingana.", en: "No matching business." },
  "Jumla iliyolipwa: {0} TZS": { sw: "Jumla iliyolipwa: {0} TZS", en: "Total paid: {0} TZS" },

};

export const INVOICING_DICT: Record<string, { sw: string; en: string }> = {
  "Invoice imehifadhiwa": { sw: "Invoice imehifadhiwa", en: "Invoice saved" },
  "Chapisha invoice iliyochaguliwa": { sw: "Chapisha invoice iliyochaguliwa", en: "Print selected invoice" },
  "Hakuna invoice bado.": { sw: "Hakuna invoice bado.", en: "No invoices yet." },
};

export const DEPT_DICT: Record<string, { sw: string; en: string }> = {
  "Clear Data File": { sw: "Clear Data File", en: "Clear Data File" },
  "Delete invoices, purchases, stock…": { sw: "Futa invoices, purchases, stock…", en: "Delete invoices, purchases, stock…" },
  "Ukurasa huu ni wa Super Admin pekee.": { sw: "Ukurasa huu ni wa Super Admin pekee.", en: "This page is for the Super Admin only." },
  "Utafuta KUDUMU: {0} ya biashara {1}. Hatua hii haiwezi kurudishwa. Endelea?": { sw: "Utafuta KUDUMU: {0} ya biashara {1}. Hatua hii haiwezi kurudishwa. Endelea?", en: "This will PERMANENTLY delete: {0} of business {1}. This cannot be undone. Continue?" },
  "Data imefutwa.": { sw: "Data imefutwa.", en: "Data deleted." },
  "Futa data ya biashara iliyochaguliwa (Super Admin pekee)": { sw: "Futa data ya biashara iliyochaguliwa (Super Admin pekee)", en: "Delete data of the selected business (Super Admin only)" },
  "Chagua data ya kufuta": { sw: "Chagua data ya kufuta", en: "Choose the data to delete" },
  "Biashara itakayoathirika:": { sw: "Biashara itakayoathirika:", en: "Business affected:" },
  "Chagua biashara kwanza (Badilisha biashara) kisha rudi hapa.": { sw: "Chagua biashara kwanza (Badilisha biashara) kisha rudi hapa.", en: "Choose a business first (Switch business), then come back here." },
  "Chagua zote": { sw: "Chagua zote", en: "Select all" },
  "Thibitisha kwa password ya Super Admin": { sw: "Thibitisha kwa password ya Super Admin", en: "Confirm with the Super Admin password" },
  "Password ya Super Admin": { sw: "Password ya Super Admin", en: "Super Admin password" },
  "Ingiza password yako ya Super Admin ili kuruhusu kufuta.": { sw: "Ingiza password yako ya Super Admin ili kuruhusu kufuta.", en: "Enter your Super Admin password to allow the deletion." },
  "Inafuta…": { sw: "Inafuta…", en: "Deleting…" },
  "Futa data iliyochaguliwa": { sw: "Futa data iliyochaguliwa", en: "Delete selected data" },
  "Inafuta data ya biashara iliyochaguliwa tu (idara zote). Tengeneza backup kwanza kupitia Backup and Restore.": { sw: "Inafuta data ya biashara iliyochaguliwa tu (idara zote). Tengeneza backup kwanza kupitia Backup and Restore.", en: "Deletes only the data of the selected business (all departments). Make a backup first via Backup and Restore." },
  "Password ya Super Admin si sahihi.": { sw: "Password ya Super Admin si sahihi.", en: "The Super Admin password is incorrect." },
  "Chagua biashara kwanza kabla ya kufuta data.": { sw: "Chagua biashara kwanza kabla ya kufuta data.", en: "Choose a business before deleting data." },
  "Chagua angalau kundi moja la data.": { sw: "Chagua angalau kundi moja la data.", en: "Choose at least one data group." },
  "Weka password ya Super Admin.": { sw: "Weka password ya Super Admin.", en: "Enter the Super Admin password." },
  "Idara imeongezwa.": { sw: "Idara imeongezwa.", en: "Department added." },
};
