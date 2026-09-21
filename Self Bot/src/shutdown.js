let _flag = false;

export function setShuttingDown(v) { _flag = !!v; }
export function isShuttingDown() { return _flag; }