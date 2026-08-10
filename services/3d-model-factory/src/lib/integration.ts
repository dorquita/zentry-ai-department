// 3D Model Factory -- Agente 11 (Web Integration Agent). Genera notas de
// integracion segun el destino declarado en el request -- puramente
// documental por ahora (no toca WordPress ni ningun sitio real). Sirve para
// que quien reciba el .glb sepa exactamente los pasos siguientes.

import { IntegrationTarget } from "../types";

export function buildIntegrationNotes(integrationTarget: IntegrationTarget, targetWebsite: string | null | undefined, productSlug: string): string[] {
	const site = targetWebsite ?? "<pendiente de definir target_website>";
	const notes: string[] = [];

	switch (integrationTarget) {
		case "configurator":
			notes.push(
				`Pensado para sustituir la geometria parametrica JS de un configurador existente (ver O23, plugin zentry-3d-configurator) por un GLTFLoader real.`,
				`Copiar el .glb a assets/models/${productSlug}.glb dentro del plugin del configurador correspondiente (fuera de alcance de O24, se hace en una fase de conexion posterior).`,
				`Los nodos del GLB deben nombrarse igual que las piezas que el configurador ya sabe mostrar/ocultar (ver components[] del manifest) para que el codigo de UI existente pueda reutilizarse sin reescribirlo.`,
				`No modificar el configurador de O23 en esta fase -- eso es una fase de integracion aparte, con su propia aprobacion.`
			);
			break;
		case "product_page":
			notes.push(
				`Pensado para insertarse en una ficha de producto WooCommerce real, ej. vía <model-viewer> o un bloque Three.js dedicado.`,
				`Requiere subir el .glb a la Media Library de ${site} (no se hace en O24 -- ver restricciones, "no tocar WordPress todavia").`,
				`Confirmar peso final del .glb antes de subir (ver Optimization Agent) -- una ficha de producto no debe cargar un asset pesado sin lazy-load.`
			);
			break;
		case "standalone_embed":
			notes.push(
				`Pensado para una pagina/demo aislada, sin depender de un configurador ni de un CMS concreto.`,
				`<model-viewer> de Google es la via mas rapida para un embed standalone sin codigo propio (ver docs/architecture.md, seccion vias tecnicas).`
			);
			break;
		case "wordpress_media":
			notes.push(
				`Solo se sube el archivo a la Media Library de ${site}, sin logica de configurador ni integracion adicional -- uso como asset descargable/visualizable suelto.`
			);
			break;
		default:
			notes.push(`integration_target no especificado en el request -- pendiente de decidir antes de conectar el modelo a ningun sitio real.`);
	}

	return notes;
}
