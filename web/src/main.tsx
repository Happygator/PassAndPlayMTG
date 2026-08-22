import { render } from 'preact';
import './style.css';
// Channel overrides must load AFTER the shared sheet: same selectors, so the
// later rule wins. Import order here is the only thing guaranteeing that.
import '@platform/style.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);
