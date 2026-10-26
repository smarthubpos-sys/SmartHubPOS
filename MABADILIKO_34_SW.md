# MABADILIKO 34 — Header ya bili/oda, Clear Data kamili, na ulinzi wa login

## 1. Header ya bili / oda (BillSheet + oda ya mhudumu)
- Jina la biashara, anwani, TEL na TIN sasa vimebanwa **upande wa kushoto**; **logo iko kulia** (mstari mmoja).
- Kichwa cha hati (BILI YA MTEJA / ODA / jina la idara) kiko chini yake, kikiwa na mistari juu na chini.
- Ukubwa wa logo unafuata karatasi: 58mm / 80mm / A4. Imefanyika kwenye `BillSheet.tsx` na `print-waiter-order.ts`.

## 2. Settings > Clear Data File
Chanzo cha tatizo: kundi la "Sales Invoices" lilifuta invoices tu. Mauzo ya **Selling Point** (`waiterOrders`, `waiterCollections`) na `customerBills` yalibaki, na dashboard ilizisoma. Pia siku za zamani za `statsDaily` (nje ya siku 120) hazikufutwa.
- "Sales Invoices" sasa inafuta pia: oda za wahudumu, makusanyo ya wahudumu na bili za wateja (biashara iliyochaguliwa tu).
- Baada ya kufuta, takwimu za dashboard (`statsDaily` zote, receivable, payable, bills due, top products) zinawekwa sifuri **papo hapo**, kisha hesabu hujengwa upya kutoka data iliyobaki.
- Jaribio jipya kwenye `convex/clearData.test.ts`.

## 3. Ulinzi wa login
Matatizo mawili yalikuwepo:
1. **Token ya login ilihifadhiwa kwa kudumu** (localStorage, siku 30). Ukifunga Chrome au tablet ikalala, mtu mwingine alifungua na kuingia kwenye akaunti yako bila password.
2. **Chrome ilikumbuka/kujaza password** kwenye fomu ya login.

Marekebisho:
- Token sasa iko kwenye `sessionStorage` (inapotea tab/browser ikifungwa). Token za zamani kwenye kifaa zinafutwa zenyewe (kila mtu atalazimika kuingia mara moja baada ya update).
- Server: login hudumu **saa 14 tu** kwa jumla na huisha baada ya **saa 2** bila matumizi (kabla ilikuwa siku 30).
- Idle logout sasa inatumia saa halisi (inafanya kazi hata tablet ikilala), na kikao kilichorejeshwa bila saa ya shughuli hakiaminiki. Default ni dakika **15** (inabadilika kwenye Maintenance > Security). **Super Admin** hawezi kuzidi dakika **10**, na "0 = imezimwa" haitumiki kwake.
- Sehemu ya password kwenye login haijazwi wala kuhifadhiwa na Chrome (masked text field, na fallback `new-password`); sehemu zote za password ndani ya Maintenance (Clear Data, Users, Change Password) zina `autocomplete="new-password"`. Fomu hujisafisha ukirudi kwa Back.

## Mambo ya kujua
- Kila tab ina login yake: ukifungua tab mpya lazima uingie tena. Ni makusudi, kwa usalama.
- Chrome ya zamani sana isiyo na `-webkit-text-security` itatumia `type=password` + `new-password` (kinga ndogo kidogo).
- **Hatua ya mara moja kwa tablet ya sasa**: kwenye Chrome futa saved passwords za tovuti hii (Settings > Passwords). Marekebisho haya hayawezi kufuta zilizohifadhiwa tayari na browser.

## Uthibitisho
`tsc -b` safi, `eslint` safi kwenye faili zilizobadilishwa, `vitest`: majaribio **363/363** yamepita. Build ya `vite build` na deploy hazijaendeshwa.
