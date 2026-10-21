import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import './i18n';
import App from './App.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { AppearanceProvider } from '@/context/AppearanceProvider';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<AppearanceProvider>
			<TooltipProvider>
				<App />
			</TooltipProvider>
		</AppearanceProvider>
	</StrictMode>,
);
