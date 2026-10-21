import { AnalysisTables } from './AnalysisTables';
import { ChartScene } from './ChartScene';
import { FreeAnalysisDocument } from './FreeAnalysisDocument';
import { Markdown } from '@/components/markdown';
import { Disclosure } from '@/components/ui/disclosure';
import type { ViewSnapshot } from '@/lib/workspace-analysis';

function Claims({ view, indexes }: { view: ViewSnapshot; indexes: number[] }) {
	if (!indexes.length) return null;
	const content = (
		<div className="space-y-3 text-sm leading-7">
			{indexes.map((i) => (
				<div key={i} data-claim-index={i}>
					<Markdown>{view.claims[i]}</Markdown>
				</div>
			))}
		</div>
	);
	return view.claimsCollapsed ? (
		<Disclosure className="diagram-fold" summary={<>展开分析解读</>}>
			<div className="diagram-content">{content}</div>
		</Disclosure>
	) : (
		content
	);
}

export function AnalysisVisuals({
	view,
	showCharts = true,
}: {
	view: ViewSnapshot;
	showCharts?: boolean;
}) {
	if (view.freeDocument)
		return (
			<FreeAnalysisDocument
				key={view.freeDocument.contentDigest}
				document={view.freeDocument}
			/>
		);
	const scenes = view.scenes;
	const summary = view.summaryClaimIndexes.length > 0 && (
		<section
			className="space-y-3 rounded-xl border border-border bg-card p-4"
			data-slot="analysis-summary"
			data-position={view.summaryPosition}
		>
			<h3 className="text-base font-semibold">{view.summaryTitle}</h3>
			<Claims view={view} indexes={view.summaryClaimIndexes} />
		</section>
	);
	return (
		<div className="presentation-composition space-y-6" data-slot="analysis-visuals">
			{view.claimsScopeLabel && (
				<Markdown className="text-sm leading-6">{view.claimsScopeLabel}</Markdown>
			)}
			{view.summaryPosition === 'start' && summary}
			<div className="presentation-grid">
				{view.sections
					.filter(
						(s) =>
							showCharts ||
							s.claimIndexes.length ||
							s.blocks.some((b) => b.metricIndexes.length || b.tableIndexes.length),
					)
					.map((section) => (
						<section
							key={section.groupId}
							data-width={section.width}
							className="min-w-0 space-y-4 rounded-xl border border-border bg-card/60 p-4"
							aria-label={section.title || undefined}
						>
							{section.title && (
								<h3 className="text-base font-semibold">{section.title}</h3>
							)}
							{section.description && (
								<div className="text-sm leading-7">
									<Markdown>{section.description}</Markdown>
								</div>
							)}
							{section.claimsPosition === 'before' && (
								<Claims view={view} indexes={section.claimIndexes} />
							)}
							{section.blocks
								.filter(
									(b) =>
										showCharts ||
										b.metricIndexes.length ||
										b.tableIndexes.length,
								)
								.map((block) => (
									<div key={block.viewId} className="space-y-3">
										{block.title &&
											(block.metricIndexes.length > 0 ||
												block.sceneIndexes.length > 1) && (
												<h4 className="text-sm font-semibold">
													{block.title}
												</h4>
											)}
										{block.description && (
											<div className="text-sm leading-7">
												<Markdown>{block.description}</Markdown>
											</div>
										)}
										{block.metricIndexes.length > 0 && (
											<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3">
												{block.metricIndexes
													.map((i) => view.metrics[i])
													.map((m) => (
														<div
															key={m.valueRef}
															className="min-w-0 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
														>
															<span className="text-xs text-muted-foreground">
																{m.label}
															</span>
															<div className="mt-2 break-words text-2xl font-semibold tracking-tight tabular-nums">
																{m.display}
																{m.unit && (
																	<span className="ml-1 text-xs font-normal">
																		{m.unit}
																	</span>
																)}
															</div>
														</div>
													))}
											</div>
										)}
										{showCharts &&
											block.sceneIndexes
												.map((i) => scenes[i])
												.map((scene, i) =>
													scene.collapsed ? (
														<Disclosure
															key={i}
															className="diagram-fold"
															summary={
																<>{scene.title || '展开图表'}</>
															}
														>
															<div className="diagram-content">
																<ChartScene
																	scene={scene}
																	showTitle={false}
																/>
															</div>
														</Disclosure>
													) : (
														<ChartScene key={i} scene={scene} />
													),
												)}
										{block.tableIndexes.length > 0 && (
											<AnalysisTables
												tables={block.tableIndexes.map((i) => ({
													...view.tables[i],
													note: '',
												}))}
											/>
										)}
									</div>
								))}
							{section.claimsPosition === 'after' && (
								<Claims view={view} indexes={section.claimIndexes} />
							)}
						</section>
					))}
			</div>
			{showCharts && view.chartUnavailable && (
				<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
					{view.chartUnavailable}
				</p>
			)}
			{view.summaryPosition === 'end' && summary}
		</div>
	);
}
