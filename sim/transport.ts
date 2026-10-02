//send time model for one updateImageRawData
//the G2_FIT numbers are least squares of g2-kit's on-glasses medians vs lz4 size of the same tiles (R² 0.94, loo rmse 38 ms)
//it includes everything per send, so the per-byte cost is an effective rate, not raw ble speed
export interface TransportModel {
  name: string
  fixedMs: number
  msPerByte: number
}

export const G2_FIT: TransportModel = { name: 'G2 fit (g2-kit timings)', fixedMs: 177, msPerByte: 0.1616 }

export function nominal(kBps: number): TransportModel {
  return { name: `${kBps} KB/s`, fixedMs: 0, msPerByte: 1 / kBps } //kb = 1000 bytes
}

export const NOMINAL_RATES = [10, 20, 30].map(nominal)

export function sendMs(wireBytes: number, model: TransportModel = G2_FIT): number {
  return model.fixedMs + wireBytes * model.msPerByte
}

//sends are sequential
export function frameMs(containerWireBytes: number[], model: TransportModel = G2_FIT): number {
  return containerWireBytes.reduce((t, b) => t + sendMs(b, model), 0)
}
