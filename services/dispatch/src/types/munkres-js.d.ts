declare module "munkres-js" {
  /** Solves the assignment problem; returns [row, col] index pairs. */
  function munkres(costMatrix: number[][]): [number, number][];
  export default munkres;
}
