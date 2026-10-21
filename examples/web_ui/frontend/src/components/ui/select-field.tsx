import type { ComponentProps, ReactNode } from 'react';

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Radix reserves an empty value for its placeholder. Encoding every option
// preserves explicit choices such as "Not configured" without a sentinel clash.
const prefix = 'option:';

type SelectFieldProps = Pick<
	ComponentProps<typeof SelectTrigger>,
	'id' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid' | 'disabled'
> & {
	value: string;
	onValueChange: (value: string) => void;
	children: ReactNode;
	className?: string;
	placeholder?: string;
};

export function SelectField({
	value,
	onValueChange,
	children,
	className,
	placeholder,
	disabled,
	...props
}: SelectFieldProps) {
	return (
		<Select
			value={`${prefix}${value}`}
			onValueChange={(next) => {
				if (next.startsWith(prefix)) onValueChange(next.slice(prefix.length));
			}}
			disabled={disabled}
		>
			<SelectTrigger
				className={cn('h-10 w-full min-w-0 bg-background', className)}
				{...props}
			>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent
				position="popper"
				align="start"
				className="max-h-[min(20rem,var(--radix-select-content-available-height))] w-(--radix-select-trigger-width)"
			>
				{children}
			</SelectContent>
		</Select>
	);
}

export function SelectOption({
	value,
	children,
	disabled,
}: {
	value: string | number;
	children: ReactNode;
	disabled?: boolean;
}) {
	return (
		<SelectItem
			value={`${prefix}${value}`}
			disabled={disabled}
			className="break-words whitespace-normal"
		>
			{children}
		</SelectItem>
	);
}
