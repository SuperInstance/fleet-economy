interface TokenTransaction {
  id: string;
  provider: string;
  service: string;
  tokens: number;
  cost: number;
  timestamp: number;
  budgetId: string;
}

interface Budget {
  id: string;
  name: string;
  totalTokens: number;
  spentTokens: number;
  dailyLimit: number;
  resetTime: number;
  providers: string[];
}

interface SimulationRequest {
  providers: Array<{
    name: string;
    costPerToken: number;
    services: string[];
  }>;
  totalBudget: number;
  durationDays: number;
  tokenUsagePattern: 'steady' | 'burst' | 'gradual';
}

interface SimulationResult {
  optimalProvider: string;
  totalCost: number;
  tokensUsed: number;
  dailyBreakdown: Array<{
    day: number;
    tokens: number;
    cost: number;
    provider: string;
  }>;
  savingsComparedToWorst: number;
}

interface EconomyDashboard {
  totalTokens: number;
  spentTokens: number;
  remainingTokens: number;
  dailyAverage: number;
  topProviders: Array<{
    name: string;
    tokens: number;
    cost: number;
  }>;
  budgetHealth: Array<{
    id: string;
    name: string;
    utilization: number;
    status: 'healthy' | 'warning' | 'critical';
  }>;
}

const DB = {
  transactions: [] as TokenTransaction[],
  budgets: [] as Budget[],
};

function createResponse(data: any, status = 200): Response {
  const headers = {
    "Content-Type": "application/json",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  };
  
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function calculateOptimalProvider(providers: SimulationRequest['providers'], tokens: number): string {
  let optimal = providers[0].name;
  let lowestCost = providers[0].costPerToken * tokens;
  
  for (const provider of providers.slice(1)) {
    const cost = provider.costPerToken * tokens;
    if (cost < lowestCost) {
      lowestCost = cost;
      optimal = provider.name;
    }
  }
  
  return optimal;
}

function generateTokenUsage(pattern: SimulationRequest['tokenUsagePattern'], days: number): number[] {
  const usage: number[] = [];
  
  switch (pattern) {
    case 'steady':
      for (let i = 0; i < days; i++) {
        usage.push(1000);
      }
      break;
      
    case 'burst':
      for (let i = 0; i < days; i++) {
        usage.push(i % 3 === 0 ? 3000 : 500);
      }
      break;
      
    case 'gradual':
      for (let i = 0; i < days; i++) {
        usage.push(500 + (i * 200));
      }
      break;
  }
  
  return usage;
}

async function handleEconomy(): Promise<Response> {
  const totalTokens = DB.budgets.reduce((sum, b) => sum + b.totalTokens, 0);
  const spentTokens = DB.transactions.reduce((sum, t) => sum + t.tokens, 0);
  
  const providerMap = new Map<string, { tokens: number; cost: number }>();
  DB.transactions.forEach(t => {
    const current = providerMap.get(t.provider) || { tokens: 0, cost: 0 };
    providerMap.set(t.provider, {
      tokens: current.tokens + t.tokens,
      cost: current.cost + t.cost,
    });
  });
  
  const topProviders = Array.from(providerMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);
  
  const budgetHealth = DB.budgets.map(budget => {
    const utilization = (budget.spentTokens / budget.totalTokens) * 100;
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (utilization > 80) status = 'critical';
    else if (utilization > 60) status = 'warning';
    
    return {
      id: budget.id,
      name: budget.name,
      utilization: Math.round(utilization * 100) / 100,
      status,
    };
  });
  
  const dashboard: EconomyDashboard = {
    totalTokens,
    spentTokens,
    remainingTokens: totalTokens - spentTokens,
    dailyAverage: DB.transactions.length > 0 
      ? Math.round(spentTokens / (DB.transactions.length / 30))
      : 0,
    topProviders,
    budgetHealth,
  };
  
  return createResponse(dashboard);
}

async function handleSimulate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SimulationRequest;
    
    if (!body.providers || body.providers.length === 0) {
      return createResponse({ error: "Providers required" }, 400);
    }
    
    const dailyUsage = generateTokenUsage(body.tokenUsagePattern, body.durationDays);
    const totalTokens = dailyUsage.reduce((sum, tokens) => sum + tokens, 0);
    
    const dailyBreakdown = dailyUsage.map((tokens, index) => {
      const optimalProvider = calculateOptimalProvider(body.providers, tokens);
      const provider = body.providers.find(p => p.name === optimalProvider)!;
      const cost = provider.costPerToken * tokens;
      
      return {
        day: index + 1,
        tokens,
        cost: Math.round(cost * 100) / 100,
        provider: optimalProvider,
      };
    });
    
    const totalCost = dailyBreakdown.reduce((sum, day) => sum + day.cost, 0);
    
    const worstProvider = body.providers.reduce((worst, current) => 
      current.costPerToken > worst.costPerToken ? current : worst
    );
    const worstCost = worstProvider.costPerToken * totalTokens;
    
    const result: SimulationResult = {
      optimalProvider: calculateOptimalProvider(body.providers, totalTokens),
      totalCost: Math.round(totalCost * 100) / 100,
      tokensUsed: totalTokens,
      dailyBreakdown,
      savingsComparedToWorst: Math.round((worstCost - totalCost) * 100) / 100,
    };
    
    return createResponse(result);
  } catch (error) {
    return createResponse({ error: "Invalid request" }, 400);
  }
}

async function handleBudgets(): Promise<Response> {
  const now = Date.now();
  const budgets = DB.budgets.map(budget => {
    const needsReset = now > budget.resetTime;
    const resetIn = Math.max(0, budget.resetTime - now);
    
    return {
      ...budget,
      needsReset,
      resetIn: Math.floor(resetIn / (1000 * 60 * 60 * 24)),
    };
  });
  
  return createResponse(budgets);
}

function renderFooter(): string {
  return `
    <footer style="
      position: fixed;
      bottom: 0;
      width: 100%;
      background: #0a0a0f;
      color: #f59e0b;
      padding: 1rem;
      text-align: center;
      border-top: 1px solid #1a1a2e;
      font-family: monospace;
      font-size: 0.9rem;
    ">
      Fleet Economy Token System | ${new Date().getFullYear()} | <a href="/health" style="color: #f59e0b; text-decoration: none;">/health</a>
    </footer>
  `;
}

async function handleHealth(): Promise<Response> {
  const health = {
    status: "healthy",
    timestamp: Date.now(),
    transactions: DB.transactions.length,
    budgets: DB.budgets.length,
    uptime: process.uptime ? Math.floor(process.uptime()) : 0,
  };
  
  return createResponse(health);
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  
  if (path === "/health") {
    return handleHealth();
  }
  
  if (path === "/api/economy" && request.method === "GET") {
    return handleEconomy();
  }
  
  if (path === "/api/simulate" && request.method === "POST") {
    return handleSimulate(request);
  }
  
  if (path === "/api/budgets" && request.method === "GET") {
    return handleBudgets();
  }
  
  if (path === "/" && request.method === "GET") {
    const html = `
      <!DOCTYPE html>
      <html lang="en" style="background: #0a0a0f; color: #ffffff;">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Fleet Economy Dashboard</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0f;
            color: #ffffff;
            min-height: 100vh;
            padding-bottom: 60px;
          }
          .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
          .header { 
            background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%);
            padding: 2rem;
            border-bottom: 2px solid #f59e0b;
            margin-bottom: 2rem;
          }
          .title { 
            color: #f59e0b;
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
          }
          .subtitle { color: #94a3b8; font-size: 1.1rem; }
          .endpoint { 
            background: #1a1a2e;
            border: 1px solid #2d2d4d;
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 1rem;
          }
          .method { 
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 4px;
            font-weight: bold;
            margin-right: 1rem;
          }
          .get { background: #10b981; color: #000; }
          .post { background: #f59e0b; color: #000; }
          .path { 
            font-family: monospace;
            color: #60a5fa;
            font-size: 1.1rem;
          }
          .desc { color: #cbd5e1; margin-top: 0.5rem; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="container">
            <h1 class="title">Fleet Economy</h1>
            <p class="subtitle">Token economy simulation and optimization system</p>
          </div>
        </div>
        
        <div class="container">
          <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/economy</span>
            <p class="desc">Retrieve current economy dashboard with token tracking and budget health</p>
          </div>
          
          <div class="endpoint">
            <span class="method post">POST</span>
            <span class="path">/api/simulate</span>
            <p class="desc">Run cost allocation simulations with provider pricing comparison</p>
          </div>
          
          <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/budgets</span>
            <p class="desc">View all budgets with spending limits and reset schedules</p>
          </div>
          
          <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/health</span>
            <p class="desc">System health check endpoint</p>
          </div>
        </div>
        
        ${renderFooter()}
      </body>
      </html>
    `;
    
    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline';",
      },
    });
  }
  
  return createResponse({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  }
};
