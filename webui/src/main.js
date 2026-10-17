import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { keepFieldsVisible } from "./lib/keyboard.js";

keepFieldsVisible();

export default mount(App, { target: document.getElementById("app") });
