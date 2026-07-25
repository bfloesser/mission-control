// Build a trade preview: live prices, transfer network, fee estimate, and
// expected profit for a given spend amount — before anything is executed.

import type { Exchange } from 'ccxt';
import { getAuthedClient, loadMarketsOnce } from './clients';
import { TAKER_FEES } from './exchanges';
import { pickNetwork, type NetworkInfo } from './execution-helpers';
import type { ExchangeId, TradePreview } from './types';

export interface PreviewRequest {
  base: string;
  buyExchange: ExchangeId;
  sellExchange: ExchangeId;
  buyQuote: string;
  sellQuote: string;
  spendAmount: number;
}

function getNetworks(client: Exchange, code: string): NetworkInfo[] {
  const currency = client.currencies?.[code] as
    | {
        active?: boolean;
        deposit?: boolean;
        withdraw?: boolean;
        fee?: number;
        networks?: Record<
          string,
          { active?: boolean; deposit?: boolean; withdraw?: boolean; fee?: number }
        >;
      }
    | undefined;
  if (!currency) return [];

  const networks = currency.networks;
  if (networks && Object.keys(networks).length > 0) {
    return Object.entries(networks).map(([code_, n]) => ({
      network: code_,
      withdrawEnabled: n.withdraw !== false && n.active !== false,
      depositEnabled: n.deposit !== false && n.active !== false,
      fee: typeof n.fee === 'number' ? n.fee : undefined,
    }));
  }
  // No per-network info — treat the currency itself as one default network
  return [
    {
      network: 'DEFAULT',
      withdrawEnabled: currency.withdraw !== false && currency.active !== false,
      depositEnabled: currency.deposit !== false && currency.active !== false,
      fee: typeof currency.fee === 'number' ? currency.fee : undefined,
    },
  ];
}

export async function buildPreview(req: PreviewRequest): Promise<TradePreview> {
  const { base, buyExchange, sellExchange, buyQuote, sellQuote, spendAmount } = req;
  if (!(spendAmount > 0)) throw new Error('Betrag muss größer als 0 sein');
  if (buyExchange === sellExchange) throw new Error('Kauf- und Verkaufsbörse müssen verschieden sein');

  const buyClient = getAuthedClient(buyExchange);
  const sellClient = getAuthedClient(sellExchange);
  await Promise.all([loadMarketsOnce(buyClient), loadMarketsOnce(sellClient)]);

  const buySymbol = `${base}/${buyQuote}`;
  const sellSymbol = `${base}/${sellQuote}`;
  if (!buyClient.markets[buySymbol]) throw new Error(`${buySymbol} existiert nicht auf ${buyExchange}`);
  if (!sellClient.markets[sellSymbol]) throw new Error(`${sellSymbol} existiert nicht auf ${sellExchange}`);

  const [buyTicker, sellTicker] = await Promise.all([
    buyClient.fetchTicker(buySymbol),
    sellClient.fetchTicker(sellSymbol),
  ]);
  const buyPrice = buyTicker.ask ?? buyTicker.last;
  const sellPrice = sellTicker.bid ?? sellTicker.last;
  if (!buyPrice || !sellPrice) throw new Error('Keine aktuellen Kurse verfügbar');

  const warnings: string[] = [];

  // Transfer network: withdraw on buy side, deposit on sell side
  const buyNetworks = getNetworks(buyClient, base);
  const sellNetworks = getNetworks(sellClient, base);
  const network = pickNetwork(buyNetworks, sellNetworks);
  if (!network) {
    throw new Error(
      `Kein gemeinsames Transfer-Netzwerk für ${base} gefunden (Auszahlung auf ${buyExchange} und Einzahlung auf ${sellExchange} müssen offen sein)`
    );
  }
  if (network.fee === undefined) {
    warnings.push('Auszahlungsgebühr unbekannt — Schätzung ohne Netzwerkgebühr');
  }
  const withdrawFee = network.fee ?? 0;

  if (buyQuote !== sellQuote) {
    warnings.push(
      `Kauf in ${buyQuote}, Verkauf in ${sellQuote} — Gewinn nimmt 1:1-Kurs zwischen beiden an`
    );
  }

  const buyFeeRate = TAKER_FEES[buyExchange];
  const sellFeeRate = TAKER_FEES[sellExchange];

  const estBaseQty = (spendAmount / buyPrice) * (1 - buyFeeRate);
  const estArriveQty = estBaseQty - withdrawFee;
  if (estArriveQty <= 0) {
    throw new Error(
      `Betrag zu klein: Auszahlungsgebühr (${withdrawFee} ${base}) übersteigt die gekaufte Menge`
    );
  }
  if (withdrawFee / estBaseQty > 0.1) {
    warnings.push('Netzwerkgebühr frisst über 10% der Menge — größeren Betrag wählen');
  }
  const estProceeds = estArriveQty * sellPrice * (1 - sellFeeRate);
  const estProfit = estProceeds - spendAmount;
  const estProfitPct = (estProfit / spendAmount) * 100;

  return {
    base,
    buyExchange,
    sellExchange,
    buyQuote,
    sellQuote,
    spendAmount,
    buyPrice,
    sellPrice,
    network: network.network,
    withdrawFee,
    estBaseQty,
    estArriveQty,
    estProceeds,
    estProfit,
    estProfitPct,
    fees: [
      { label: 'Kauf (Taker)', amount: spendAmount * buyFeeRate, currency: buyQuote },
      { label: 'Netzwerk/Auszahlung', amount: withdrawFee, currency: base },
      { label: 'Verkauf (Taker)', amount: estArriveQty * sellPrice * sellFeeRate, currency: sellQuote },
    ],
    warnings,
  };
}
