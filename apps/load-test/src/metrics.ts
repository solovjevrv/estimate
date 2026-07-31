/** Копит длительности (мс) одного вида операции и отдаёт перцентили по прогону целиком */
export class LatencyRecorder {
  private readonly samplesMs: number[] = [];

  record(ms: number): void {
    this.samplesMs.push(ms);
  }

  get count(): number {
    return this.samplesMs.length;
  }

  private percentile(p: number): number {
    if (this.samplesMs.length === 0) return 0;
    const sorted = [...this.samplesMs].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[index] ?? 0;
  }

  summary(): { count: number; p50Ms: number; p95Ms: number; maxMs: number } {
    return {
      count: this.count,
      p50Ms: Math.round(this.percentile(50)),
      p95Ms: Math.round(this.percentile(95)),
      maxMs: Math.round(this.samplesMs.length ? Math.max(...this.samplesMs) : 0),
    };
  }
}
