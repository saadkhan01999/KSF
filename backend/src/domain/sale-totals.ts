/* ==========================================================================
   What a sale comes to
   --------------------------------------------------------------------------
   One calculation, used by the server to charge and by the till to show the
   same figure before anyone presses Complete sale. The till keeps an exact
   copy (frontend/src/utils/sale-totals.ts); a unit test runs both on the
   same carts and fails if they ever differ by a paisa.

   GST is the cashier's choice on each sale (off unless Settings › Till
   turns it on by default). When it is added:
     - a medicine with its own GST % keeps that rate; every other line uses
       the pharmacy's default rate (Settings › Pharmacy);
     - it is charged on what the customer actually pays for the line: the
       discount is shared across the lines in proportion to their value, in
       whole paisa, before the tax is worked out.
   ========================================================================== */

export interface TotalsLine {
  /** Unit price × quantity, in paisa. */
  lineTotalPaisa: number;
  /** The medicine's own GST rate; 0 or missing means "use the pharmacy's". */
  gstPercent?: number | null;
}

export interface SaleTotalsInput {
  lines: TotalsLine[];
  discountPaisa?: number;
  applyGst?: boolean;
  /** The pharmacy's default GST rate (Settings › Pharmacy). */
  defaultGstPercent?: number | null;
}

export interface SaleTotals {
  subtotalPaisa: number;
  discountPaisa: number;
  gstPaisa: number;
  totalPaisa: number;
  /** GST on each line, in the order given. */
  lineGstPaisa: number[];
  /** The rate when every taxed line shares one, for the receipt ("GST 18%"); otherwise null. */
  gstRatePercent: number | null;
  /** True when GST was asked for but no line has any rate to charge. */
  gstRateMissing: boolean;
}

const rateOf = (value: number | null | undefined): number => {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? Math.min(rate, 100) : 0;
};

/** The discount shared across lines in proportion to their value, in whole paisa, adding up exactly. */
function shareDiscount(lineTotals: number[], subtotal: number, discount: number): number[] {
  if (discount <= 0 || subtotal <= 0) return lineTotals.map(() => 0);
  const exact = lineTotals.map((value) => (discount * value) / subtotal);
  const shares = exact.map((value) => Math.floor(value));
  let left = discount - shares.reduce((sum, value) => sum + value, 0);
  /* The paisa left over go to the lines that lost the most to rounding down. */
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return shares;
}

export function saleTotals({ lines, discountPaisa = 0, applyGst = false, defaultGstPercent = 0 }: SaleTotalsInput): SaleTotals {
  const lineTotals = lines.map((line) => Math.max(0, Math.round(Number(line.lineTotalPaisa) || 0)));
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const discount = Math.min(subtotal, Math.max(0, Math.round(Number(discountPaisa) || 0)));
  const shares = shareDiscount(lineTotals, subtotal, discount);
  const fallback = rateOf(defaultGstPercent);

  const rates = lines.map((line) => (applyGst ? rateOf(line.gstPercent) || fallback : 0));
  const lineGst = lineTotals.map((value, index) => (rates[index] > 0 ? Math.round(((value - shares[index]) * rates[index]) / 100) : 0));
  const gst = lineGst.reduce((sum, value) => sum + value, 0);
  const used = [...new Set(rates.filter((rate) => rate > 0))];

  return {
    subtotalPaisa: subtotal,
    discountPaisa: discount,
    gstPaisa: gst,
    totalPaisa: subtotal - discount + gst,
    lineGstPaisa: lineGst,
    gstRatePercent: used.length === 1 ? used[0] : null,
    gstRateMissing: applyGst && lines.length > 0 && used.length === 0
  };
}
