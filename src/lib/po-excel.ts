/** One Purchase Order as an Excel file (.xlsx): business, order details, the lines and the total. */
export type PoSheet = {
  orderRef: string; orderDate: string; expectedDelivery: string; status: string; notes: string; total: number;
  supplier: { name: string; phone: string; address: string };
  lines: Array<{ itemCode: string; productName: string; unit: string; qtyOrdered: number; unitCost: number; lineTotal: number }>;
};

/** Rows of the sheet as plain values, so they can be tested without a browser. */
export function poRows(businessName: string, o: PoSheet): Array<Array<string | number>> {
  return [
    [businessName],
    ["PURCHASE ORDER", o.orderRef],
    ["Date", o.orderDate],
    ["Expected delivery", o.expectedDelivery || "-"],
    ["Supplier", o.supplier.name],
    ["Phone", o.supplier.phone || "-"],
    ["Address", o.supplier.address || "-"],
    [],
    ["#", "Code", "Product", "Unit", "Quantity", "Unit cost", "Total"],
    ...o.lines.map((l, i) => [i + 1, l.itemCode, l.productName, l.unit, l.qtyOrdered, l.unitCost, l.lineTotal]),
    [],
    ["", "", "", "", "", "TOTAL", o.total],
    ...(o.notes ? [[], ["Notes", o.notes]] : []),
  ];
}

export async function downloadOrderExcel(businessName: string, o: PoSheet) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Purchase Order");
  for (const row of poRows(businessName, o)) ws.addRow(row);
  ws.columns = [{ width: 8 }, { width: 14 }, { width: 34 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 14 }];
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.getRow(2).font = { bold: true };
  ws.getRow(9).font = { bold: true };
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${o.orderRef}.xlsx`; a.click();
  URL.revokeObjectURL(url);
}
