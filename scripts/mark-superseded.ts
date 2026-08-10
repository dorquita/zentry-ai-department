import { setProductAssetStatus } from "../src/core/product-asset-requests";

const r1 = setProductAssetStatus("prod-asset-f82e4ccd-f429-493a-aaa8-8d1c5ae189c9", "superseded", {
  notes:
    "Superseded en O21.2c: percheros salieron como percha simple en fila, no percha doble en J. Reemplazada por prod-asset-6998ea43-1135-4d84-aa07-5a276dd99fa7 (mediaId 2024). Media antigua (mediaId 2022) NO borrada, sigue en la Media Library de staging para rollback.",
});
console.log("1988 old ->", r1?.status, r1?.notes);

const r2 = setProductAssetStatus("prod-asset-95be7d6a-347e-494f-94bb-44cabc9c91e1", "superseded", {
  notes:
    "Superseded en O21.2c: percheros salieron como percha simple en fila, no percha doble en J. Reemplazada por prod-asset-0634c0b6-341d-4f23-a643-810966a59e1a (mediaId 2025). Media antigua (mediaId 2023) NO borrada, sigue en la Media Library de staging para rollback.",
});
console.log("2013 old ->", r2?.status, r2?.notes);
