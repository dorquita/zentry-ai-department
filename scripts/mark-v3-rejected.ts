import { setProductAssetStatus } from "../src/core/product-asset-requests";

const r = setProductAssetStatus("prod-asset-00a535f1-5d63-4c09-afca-92b920668273", "failed", {
  notes:
    "O21.2d: generada y subida (mediaId 2026) pero NO asociada al producto -- revision visual encontro que el perchero doble en J salio peor que la version anterior (6 ganchos en fila + 1 gancho suelto sin pareja, en vez de 6 pares consistentes). Producto 2013 se mantiene con mediaId 2025 (prod-asset-0634c0b6-341d-4f23-a643-810966a59e1a, status associated, sin cambios). Media 2026 no borrada, queda en la Media Library de staging sin usar.",
});
console.log("v3 melamina ->", r?.status, r?.notes);
