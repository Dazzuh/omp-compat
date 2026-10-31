// Regression drill: ABORT_MARKER is exported by @oh-my-pi/pi-coding-agent 18.1.5 and removed in 18.1.6.
import { ABORT_MARKER } from "@oh-my-pi/pi-coding-agent";

void ABORT_MARKER;
export default function () {}
