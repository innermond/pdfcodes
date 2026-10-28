// Minimal typings for the parts of clipper-lib (Clipper 6.4 JS port) we use.
declare module 'clipper-lib' {
  export interface IntPoint { X: number; Y: number }
  export type Path = IntPoint[]
  export type Paths = Path[]
  const ClipperLib: {
    JoinType: { jtSquare: number; jtRound: number; jtMiter: number }
    EndType: { etClosedPolygon: number; etClosedLine: number; etOpenButt: number; etOpenSquare: number; etOpenRound: number }
    PolyType: { ptSubject: number; ptClip: number }
    ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number }
    PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number }
    Clipper: {
      new (): {
        AddPaths(paths: Paths, polyType: number, closed: boolean): boolean
        Execute(clipType: number, solution: Paths, subjFill: number, clipFill: number): boolean
      }
      Area(path: Path): number
      Orientation(path: Path): boolean
      CleanPolygons(paths: Paths, distance: number): Paths
      SimplifyPolygons(paths: Paths, fillType: number): Paths
    }
    ClipperOffset: {
      new (miterLimit?: number, arcTolerance?: number): {
        AddPaths(paths: Paths, joinType: number, endType: number): void
        Execute(solution: Paths, delta: number): void
      }
    }
  }
  export default ClipperLib
}
