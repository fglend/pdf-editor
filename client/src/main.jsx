import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// No StrictMode: Fabric canvases own their DOM and shouldn't be double-mounted in dev.
createRoot(document.getElementById('root')).render(<App />);
