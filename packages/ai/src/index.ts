/**
 * @atlas/ai - the AI Engine (docs/10). Turns a natural-language question into a grounded,
 * cited, confidence-scored answer over the knowledge graph. Per P1, the graph is the
 * product and the AI is one interface: retrieval over a correct graph is the engine; the
 * LLM is a constrained narrator/planner (AE-4). NestJS-free - the API wires a RetrievalPort
 * + an LLMProvider.
 *
 * G3.1 lays the foundation: LLM provider abstraction (+ mock/Claude), the versioned system
 * prompt, and the retrieval port. Planner (G3.2), context+grounding (G3.3), the answer
 * pipeline + eval (G3.4), and SSE endpoints (G3.5) build on it.
 */
export type {
  LLMProvider,
  CompleteRequest,
  LLMEvent,
  ChatMessage,
  ToolCall,
  ToolSpec,
} from "./llm";
export { MockLLMProvider, streamText } from "./mock-provider";
export type { MockResponder } from "./mock-provider";
export { ClaudeProvider } from "./claude-provider";
export type { ClaudeConfig } from "./claude-provider";
export { OpenRouterProvider } from "./openrouter-provider";
export type { OpenRouterConfig } from "./openrouter-provider";
export {
  SYSTEM_PROMPT,
  PROMPT_VERSION,
  PLANNER_SYSTEM,
  PLANNER_PROMPT_VERSION,
  ADVISORY_SYSTEM,
  ADVISORY_PROMPT_VERSION,
  honestAbsence,
} from "./prompt";
export { buildAdvisoryContext } from "./context";
export { matchEdges } from "./edge-matcher";
export type {
  EdgeMatcherInput,
  EdgeSuggestion,
  RuntimeCandidate,
  RepoCandidate,
} from "./edge-matcher";
export { guidanceFor, KNOWLEDGE_PACK_VERSION } from "./knowledge";
export type { Guidance } from "./knowledge";
export { FRAMEWORKS, CONTROLS, evaluateControls, summarizeByFramework } from "./compliance";
export type {
  Framework,
  FrameworkMeta,
  ControlStatus,
  ControlDomain,
  Control,
  ComplianceFacts,
  ControlResult,
  FrameworkSummary,
  EvidenceRef as ComplianceEvidenceRef,
} from "./compliance";
export { TOOL_SPECS, TOOL_NAMES, runTool } from "./tools";
export type { ToolOutcome } from "./tools";
export { retrievalLoop, collectLoop, ContextAccumulator } from "./loop";
export type { RetrievalStep, LoopResult } from "./loop";
export type {
  RetrievalPort,
  SearchHit,
  RetrievedNode,
  RetrievedEdge,
  Traversal,
  TraversalImpacted,
  TraversalOpts,
  ViaEdge,
  TimelineChange,
  EstateOverview,
  NodeEventFact,
  PrDiff,
} from "./retrieval-port";
export { classifyIntent, extractTerms, resolveEntity, plan } from "./planner";
export type { Intent, RetrievalPlan, ResolvedEntity } from "./planner";
export { orchestrate } from "./retrieval";
export type { RetrievalResult } from "./retrieval";
export { buildContext } from "./context";
export type { BuiltContext, Cite } from "./context";
export { groundingGate } from "./grounding";
export type { Grounding } from "./grounding";
export {
  answerQuestion,
  answerQuestionStream,
  bindCitations,
  detectUncitedClaims,
  scoreConfidence,
} from "./answer";
export type { Answer, AnswerCitation, AnswerDeps, AnswerEvent, OverallConfidence } from "./answer";
export {
  judgeCoverage,
  extractAcceptanceCriteria,
  segmentDiff,
  parseCoverageLines,
} from "./coverage";
export type {
  CoverageInputs,
  CoverageAssessment,
  CoverageCriterion,
  CoverageCitation,
  CoverageStatus,
  CriterionStatus,
  CoverageDeps,
  CoveragePr,
  IntentIssue,
  IntentSubtask,
  IntentComment,
  DiffHunk,
} from "./coverage";
export { COVERAGE_SYSTEM, COVERAGE_PROMPT_VERSION } from "./prompt";
export { suggestIntentLinks } from "./intent-links";
export type { FuzzyPr, FuzzyIssue, IntentLinkSuggestion, IntentLinkOpts } from "./intent-links";
