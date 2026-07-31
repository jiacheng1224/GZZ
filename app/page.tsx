import { GAME_CORE_VERSION } from "@/packages/game-core/src";

const foundations = [
  {
    id: "01",
    title: "规则核心独立",
    copy: "阵型、合法动作与胜负只由纯 TypeScript 领域层计算。",
  },
  {
    id: "02",
    title: "确定性对局",
    copy: "命令、事件与种子随机数将支持测试、回放、AI 和联机。",
  },
  {
    id: "03",
    title: "信息边界明确",
    copy: "公开局面、己方手牌和服务端全量状态通过投影严格隔离。",
  },
] as const;

export default function Home() {
  return (
    <main className="project-shell">
      <header className="project-header">
        <div>
          <p className="eyebrow">RULES ENGINE · R1</p>
          <h1>古战阵</h1>
          <p className="subtitle">Web 游戏工程基线与规则核心入口</p>
        </div>
        <div className="phase-badge" aria-label="当前阶段：基础规则引擎">
          <span className="phase-dot" />
          基础规则引擎
        </div>
      </header>

      <section className="hero-panel" aria-labelledby="foundation-heading">
        <div className="hero-copy">
          <p className="section-label">当前交付</p>
          <h2 id="foundation-heading">先把规则做成可信赖的系统</h2>
          <p>
            已完成无战术牌基础局的确定性规则闭环：同一种子与命令序列可复现，
            规则结果由自动化测试与随机对局共同验证。
          </p>
        </div>
        <dl className="status-grid">
          <div>
            <dt>核心版本</dt>
            <dd>{GAME_CORE_VERSION}</dd>
          </div>
          <div>
            <dt>战线规格</dt>
            <dd>9</dd>
          </div>
          <div>
            <dt>当前里程碑</dt>
            <dd>R1</dd>
          </div>
        </dl>
      </section>

      <section className="foundation-grid" aria-label="架构原则">
        {foundations.map((item) => (
          <article className="foundation-card" key={item.id}>
            <span>{item.id}</span>
            <h2>{item.title}</h2>
            <p>{item.copy}</p>
          </article>
        ))}
      </section>

      <section className="next-panel">
        <div>
          <p className="section-label">NEXT · R2</p>
          <h2>提前占旗与完整战术规则</h2>
        </div>
        <ol>
          <li>公开信息模型与提前占旗求解器</li>
          <li>非法占旗的可反超牌组 witness</li>
          <li>10 张战术牌与多步骤效果状态</li>
          <li>玩家视图投影与完整规则压力测试</li>
        </ol>
      </section>
    </main>
  );
}
