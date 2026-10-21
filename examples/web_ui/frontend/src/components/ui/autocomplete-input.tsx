import { ChevronDown, Check } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type Option = { value: string; label: string };

export function AutocompleteInput({
	value,
	onValueChange,
	options,
	emptyText,
	...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'list' | 'role'> & {
	value: string;
	onValueChange: (value: string) => void;
	options: Option[];
	emptyText: string;
}) {
	const listId = useId();
	const anchor = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState<string | null>(null);
	const [active, setActive] = useState(-1);
	const visible =
		filter === null
			? options
			: options.filter((option) =>
					`${option.label} ${option.value}`
						.toLocaleLowerCase()
						.includes(filter.toLocaleLowerCase()),
				);
	const activeId = open && visible[active] ? `${listId}-${active}` : undefined;
	const changeOpen = (next: boolean) => {
		setOpen(next);
		setActive(-1);
		setFilter(null);
	};
	const choose = (option: Option) => {
		onValueChange(option.value);
		changeOpen(false);
		input.current?.focus();
	};
	useEffect(() => {
		if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
	}, [activeId]);

	return (
		<Popover open={open && !props.disabled} onOpenChange={changeOpen}>
			<PopoverAnchor asChild>
				<div ref={anchor} className="relative min-w-0">
					<Input
						{...props}
						ref={input}
						value={value}
						className={cn('pr-10', props.className)}
						role="combobox"
						aria-autocomplete="list"
						aria-expanded={open && !props.disabled}
						aria-controls={listId}
						aria-activedescendant={activeId}
						autoComplete="off"
						onChange={(event) => {
							onValueChange(event.target.value);
							setFilter(event.target.value);
							setActive(-1);
							setOpen(true);
						}}
						onKeyDown={(event) => {
							props.onKeyDown?.(event);
							if (event.defaultPrevented || event.nativeEvent.isComposing) return;
							if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
								event.preventDefault();
								setOpen(true);
								const count = visible.length;
								setActive(
									count
										? active < 0
											? event.key === 'ArrowDown'
												? 0
												: count - 1
											: (active +
													(event.key === 'ArrowDown' ? 1 : -1) +
													count) %
												count
										: -1,
								);
							} else if (event.key === 'Enter' && open) {
								event.preventDefault();
								if (visible[active]) choose(visible[active]);
								else changeOpen(false);
							} else if (event.key === 'Escape' && open) {
								event.preventDefault();
								event.stopPropagation();
								changeOpen(false);
							} else if (event.key === 'Tab') {
								changeOpen(false);
							}
						}}
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						tabIndex={-1}
						disabled={props.disabled}
						aria-label={props['aria-label']}
						aria-haspopup="listbox"
						aria-expanded={open && !props.disabled}
						className="absolute top-1/2 right-1 -translate-y-1/2"
						onPointerDown={(event) => event.preventDefault()}
						onClick={() => {
							if (input.current?.matches(':disabled')) return;
							changeOpen(!open);
							input.current?.focus();
						}}
					>
						<ChevronDown aria-hidden="true" />
					</Button>
				</div>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				className="w-(--radix-popover-trigger-width) min-w-48 p-1"
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				onInteractOutside={(event) => {
					if (anchor.current?.contains(event.target as Node)) event.preventDefault();
				}}
			>
				<div
					id={listId}
					role="listbox"
					aria-label={props['aria-label']}
					className="max-h-60 overflow-y-auto"
				>
					{visible.map((option, index) => (
						<Button
							key={option.value}
							id={`${listId}-${index}`}
							type="button"
							variant="ghost"
							role="option"
							aria-selected={value === option.value}
							tabIndex={-1}
							className={cn(
								'h-auto w-full justify-start whitespace-normal text-left',
								active === index && 'bg-accent text-accent-foreground',
							)}
							onPointerDown={(event) => event.preventDefault()}
							onPointerMove={() => setActive(index)}
							onClick={() => choose(option)}
						>
							<Check
								aria-hidden="true"
								className={cn(
									'size-3.5 shrink-0',
									value !== option.value && 'invisible',
								)}
							/>
							<span className="min-w-0 break-words">{option.label}</span>
						</Button>
					))}
					{!visible.length && (
						<p className="p-2 text-sm text-muted-foreground">{emptyText}</p>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
