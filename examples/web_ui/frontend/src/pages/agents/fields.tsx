import { useQuery } from '@tanstack/react-query';
import { Children, cloneElement, isValidElement, useId, useState, type ReactNode } from 'react';

import type { ResourceCatalog } from '@/api/agent-management';
import { modelApi, realtimeModelApi, ttsModelApi } from '@/api/model';
import type {
	ChatModelConfig,
	JSONSchema,
	ModelCard,
	RealtimeModelCard,
	TTSModelCard,
} from '@/api/types';
import { SchemaForm, type SchemaFormValue } from '@/components/form/SchemaForm';
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Disclosure } from '@/components/ui/disclosure';
import { Field as UIField, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/ui/select-field';
import { Textarea } from '@/components/ui/textarea';

export function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<UIField>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			{Children.map(children, (child) => {
				if (
					isValidElement<{ id?: string; 'aria-describedby'?: string }>(child) &&
					[Input, Textarea, SelectField, AutocompleteInput].includes(
						child.type as typeof Input,
					)
				) {
					return cloneElement(child, {
						id,
						'aria-describedby': hint ? `${id}-hint` : undefined,
					});
				}
				return child;
			})}
			{hint && (
				<FieldDescription
					id={`${id}-hint`}
					className="text-xs leading-5 font-normal text-muted-foreground"
				>
					{hint}
				</FieldDescription>
			)}
		</UIField>
	);
}
export function Check({
	label,
	checked,
	onChange,
	disabled,
}: {
	label: string;
	checked: boolean | 'indeterminate';
	onChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	const id = useId();
	return (
		<UIField orientation="horizontal" data-disabled={disabled || undefined}>
			<Checkbox
				id={id}
				checked={checked}
				onCheckedChange={(next) => onChange(next === true)}
				disabled={disabled}
			/>
			<FieldLabel htmlFor={id} className="min-w-0 break-words font-normal">
				{label}
			</FieldLabel>
		</UIField>
	);
}
export function JsonField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: Record<string, unknown>;
	onChange: (value: Record<string, unknown>) => void;
}) {
	const [text, setText] = useState(JSON.stringify(value, null, 2));
	const [previous, setPrevious] = useState(value);
	const [error, setError] = useState('');
	// Synchronize external form/import changes without resetting the cursor on
	// every valid JSON keystroke.
	if (previous !== value) {
		setPrevious(value);
		if (JSON.stringify(previous) !== JSON.stringify(value)) {
			setText(JSON.stringify(value, null, 2));
			setError('');
		}
	}
	return (
		<Field label={label}>
			<Textarea
				ref={(node) => {
					node?.setCustomValidity(error);
				}}
				value={text}
				rows={6}
				className="font-mono text-xs"
				onChange={(e) => {
					const next = e.target.value;
					setText(next);
					try {
						const parsed: unknown = JSON.parse(next);
						if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
							throw new Error('请填写 JSON 对象');
						setPrevious(parsed as Record<string, unknown>);
						onChange(parsed as Record<string, unknown>);
						setError('');
						e.target.setCustomValidity('');
					} catch {
						setError('请输入有效的 JSON 对象');
						e.target.setCustomValidity('请输入有效的 JSON 对象');
					}
				}}
			/>
			{error && (
				<span role="alert" className="text-destructive text-xs">
					{error}
				</span>
			)}
		</Field>
	);
}
export function ModelField({
	label,
	value,
	onChange,
	catalog,
	kind = 'chat',
}: {
	label: string;
	value: ChatModelConfig | null;
	onChange: (value: ChatModelConfig | null) => void;
	catalog: ResourceCatalog;
	kind?: 'chat' | 'tts' | 'realtime';
}) {
	const id = useId();
	const credential = catalog.credentials.find((c) => c.id === value?.credential_id);
	const models = useQuery({
		queryKey: ['agent-models', kind, credential?.type],
		enabled: !!credential,
		queryFn: async (): Promise<{
			models: (ModelCard | RealtimeModelCard | TTSModelCard)[];
		}> => {
			const api =
				kind === 'tts' ? ttsModelApi : kind === 'realtime' ? realtimeModelApi : modelApi;
			return api.list(credential!.type);
		},
	});
	const card = models.data?.models.find((m) => m.name === value?.model);
	const applyModel = (name: string) => {
		if (!value || !credential) return;
		const selected = models.data?.models.find((m) => m.name === name);
		onChange({
			...value,
			model: name,
			type:
				kind === 'realtime' && selected && 'model_type' in selected
					? selected.model_type
					: credential.type,
		});
	};
	return (
		<section className="space-y-4 rounded-xl border bg-card p-5">
			<h3 className="font-medium">{label}</h3>
			<Field label="AI 资源">
				<SelectField
					aria-label={`${label} AI 资源`}
					value={value?.credential_id ?? ''}
					onValueChange={(nextValue) => {
						const selected = catalog.credentials.find((c) => c.id === nextValue);
						onChange(
							selected
								? {
										type: selected.type,
										credential_id: selected.id,
										model: '',
										parameters: {},
									}
								: null,
						);
					}}
				>
					<SelectOption value="">不配置</SelectOption>
					{value && !credential && (
						<SelectOption value={value.credential_id}>
							资源不可用 · 请重新选择
						</SelectOption>
					)}
					{catalog.credentials.map((c) => (
						<SelectOption key={c.id} value={c.id}>
							{c.name}
						</SelectOption>
					))}
				</SelectField>
			</Field>
			{value && (
				<>
					<Field
						label="模型名称"
						hint="可选择候选模型，也可以输入服务支持的自定义模型名称。"
					>
						<AutocompleteInput
							aria-label={`${label}模型名称`}
							required
							value={value.model}
							onValueChange={applyModel}
							options={(models.data?.models ?? []).map((model) => ({
								value: model.name,
								label:
									model.label && model.label !== model.name
										? `${model.label} · ${model.name}`
										: model.name,
							}))}
							emptyText="没有匹配的候选项，可直接输入自定义模型名称。"
						/>
					</Field>
					{kind === 'realtime' && (
						<Field label="实时模型适配器">
							<Input
								required
								value={value.type}
								onChange={(e) => onChange({ ...value, type: e.target.value })}
							/>
						</Field>
					)}
					{card && (
						<SchemaForm
							schema={card.parameter_schema as unknown as JSONSchema}
							values={value.parameters as Record<string, SchemaFormValue>}
							onChange={(key, v) =>
								onChange({
									...value,
									parameters: { ...value.parameters, [key]: v },
								})
							}
							idPrefix={id}
						/>
					)}
					<Disclosure
						summary={<>高级模型参数</>}
						summaryClassName="cursor-pointer text-sm text-muted-foreground"
					>
						<div className="mt-3">
							<JsonField
								label="参数 JSON"
								value={value.parameters}
								onChange={(parameters) => onChange({ ...value, parameters })}
							/>
						</div>
					</Disclosure>
				</>
			)}
		</section>
	);
}
