import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("omp-compat-good", {
		description: "omp-compat fixture command",
		handler: async () => {},
	});
}
