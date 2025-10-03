import { describe, it, expect } from 'vitest';
import { Vertex } from '../../src/domain/entities/Vertex.js';
import { Coordinate } from '../../src/domain/value-objects/Coordinate.js';

describe('Vertex', () => {
  it('returns a Coordinate instance with matching values', () => {
    const vertex = new Vertex('vertex-1', 42, -7);
    const coordinate = vertex.getCoordinate();

    expect(coordinate).toBeInstanceOf(Coordinate);
    expect(coordinate.x).toBe(42);
    expect(coordinate.y).toBe(-7);
  });
});
