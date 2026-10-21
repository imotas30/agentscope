import { ChevronRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export function Disclosure({
	summary,
	children,
	className,
	summaryClassName,
	contentClassName,
	...props
}: Omit<ComponentProps<typeof Collapsible>, 'children'> & {
	summary: ReactNode;
	children: ReactNode;
	summaryClassName?: string;
	contentClassName?: string;
}) {
	return (
		<Collapsible className={className} {...props}>
			<CollapsibleTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					className={cn(
						'group h-auto max-w-full justify-start gap-2 px-0 py-1 text-left font-medium whitespace-normal hover:bg-transparent',
						summaryClassName,
					)}
				>
					<ChevronRight
						aria-hidden="true"
						className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
					/>
					<span className="min-w-0">{summary}</span>
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent
				forceMount
				className={cn('data-[state=closed]:hidden', contentClassName)}
			>
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}
