/**
 * Where the suite reaches the app and the stand-in panel.
 *
 * The panel is on loopback on purpose: nothing in this suite may point the app
 * at a real machine, where customers' sites and data live.
 */
export const APP_URL = 'http://localhost:3000';
export const PANEL_PORT = 8899;
export const PANEL_URL = `http://127.0.0.1:${PANEL_PORT}`;
