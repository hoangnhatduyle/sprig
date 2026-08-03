-- Seeds the default two-bed garden layout every environment (local and
-- production) is expected to have. The 3D scene maps real Bed rows onto a
-- fixed GLB model with exactly two physical beds named "Left"/"Right"
-- (src/domain/garden-3d/cell-node-mapping.ts, garden-3d-adapter.ts's
-- resolveBedSide) - without matching Bed/GridCell rows in the database, the
-- 2D grid and the 3D overlay both render as empty, which is what happened
-- here: neither localhost nor production ever had this data, since the app
-- has no runtime "create bed" action (seedBed() in grid-cell-service.ts is
-- only ever called from tests).
--
-- ON CONFLICT DO NOTHING makes this safe to run against a database that
-- already has beds by these names - the GridCell insert only fires for beds
-- actually created by this migration, so it can't create a partial or
-- duplicate grid either.
WITH inserted_beds AS (
  INSERT INTO "Bed" ("id", "name", "gridCols", "gridRows", "compassPosition")
  VALUES
    (gen_random_uuid()::text, 'Left Bed', 4, 8, 'SOUTH'),
    (gen_random_uuid()::text, 'Right Bed', 4, 8, 'NORTH')
  ON CONFLICT ("name") DO NOTHING
  RETURNING "id"
)
INSERT INTO "GridCell" ("id", "bedId", "column", "row", "baselineLight")
SELECT
  gen_random_uuid()::text,
  inserted_beds."id",
  col,
  row,
  -- Mirrors baselineLightFor() in src/domain/grid/grid-cell-service.ts:
  -- west half of an 8-row bed is partial shade, east half full sun.
  CASE WHEN row <= 4 THEN 'PARTIAL_SHADE'::"BaselineLight" ELSE 'FULL_SUN'::"BaselineLight" END
FROM inserted_beds
CROSS JOIN generate_series(1, 4) AS col
CROSS JOIN generate_series(1, 8) AS row;
