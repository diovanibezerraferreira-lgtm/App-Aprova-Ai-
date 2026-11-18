export const SUPPORT_EMAIL = 'suporteappaprovadireito@gmail.com';

export const SUPPORT_SUBJECT_OPTIONS = [
  'Pagamento',
  'Assinatura Premium',
  'Problema de acesso',
  'Questões e simulados',
  'Apostilas',
  'Outros',
] as const;

export type SupportSubjectOption = (typeof SUPPORT_SUBJECT_OPTIONS)[number];

export interface SupportFaqItem {
  id: string;
  question: string;
  answer: string;
}

export const SUPPORT_FAQ_ITEMS: SupportFaqItem[] = [
  {
    id: 'acessar-premium',
    question: 'Como acessar o Premium?',
    answer:
      'Entre na sua conta do Aprova Direito (ou crie seu cadastro gratuito), abra a aba Assinar Premium, informe seu nome completo e CPF para emissão da assinatura pelo Asaas e conclua o pagamento na página segura via Pix ou Cartão de Crédito recorrente (R$ 29,90/mês). Assim que o Asaas confirmar a compensação via webhook, o acesso Premium é liberado automaticamente na sua conta.',
  },
  {
    id: 'assinatura-mensal',
    question: 'Como funciona a assinatura mensal?',
    answer:
      'O Plano Premium custa R$ 29,90 por mês, sem fidelidade, e libera acesso ilimitado ao banco de questões comentadas, simulados cronometrados, laboratório de peças da 2ª fase, apostilas completas e painel de desempenho. Sem assinatura ativa, você continua utilizando o Plano Gratuito (até 10 questões por dia, 1 simulado por dia, 2 peças completas e 3 apostilas com o 1º capítulo liberado).',
  },
  {
    id: 'cancelamento',
    question: 'Como funciona o cancelamento?',
    answer:
      'Você pode cancelar a qualquer momento, sem multa. Após o cancelamento da assinatura no Asaas, novas cobranças são interrompidas, mas o seu acesso Premium continua ativo até o término do período mensal que já foi pago. Quando a data de validade paga for atingida sem nova cobrança confirmada, a conta retorna automaticamente para o Plano Gratuito. Em casos de reembolso ou chargeback confirmados no pagamento vigente, o acesso Premium é encerrado imediatamente.',
  },
  {
    id: 'recuperar-acesso',
    question: 'Como recuperar o acesso?',
    answer:
      'Verifique se você entrou no aplicativo com o mesmo e-mail utilizado na assinatura. Em seguida, abra a aba Assinar Premium (ou Meu Perfil) e toque em "Atualizar Status" para sincronizar pagamentos confirmados na API de Produção do Asaas, inclusive em assinaturas canceladas cujo período mensal ainda esteja vigente. Se o acesso não regularizar ou você não lembrar o e-mail cadastrado, envie uma solicitação pelo formulário abaixo ou para suporteappaprovadireito@gmail.com informando seu nome, e-mail da conta e data do pagamento.',
  },
  {
    id: 'contato-suporte',
    question: 'Como entrar em contato com o suporte?',
    answer:
      'Você pode clicar em "Enviar e-mail ao suporte" para escrever diretamente para suporteappaprovadireito@gmail.com, ou preencher o formulário desta página e clicar em "Enviar solicitação" para abrir seu aplicativo de e-mail com destinatário, assunto e descrição já preenchidos. Por segurança, nunca envie sua senha ou dados de cartão.',
  },
];

function stripControlChars(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

export interface SupportMailtoParams {
  name?: string;
  email?: string;
  subject?: string;
  description?: string;
}

export function buildDirectSupportMailtoUrl(): string {
  return `mailto:${SUPPORT_EMAIL}`;
}

export function buildSupportMailtoUrl(params: SupportMailtoParams): string {
  const cleanSubjectChoice = stripControlChars(params.subject || 'Outros') || 'Outros';
  const cleanName = stripControlChars(params.name || '');
  const cleanEmail = stripControlChars(params.email || '');
  const cleanDescription = String(params.description || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();

  const emailSubject = `[Aprova Direito - Suporte] ${cleanSubjectChoice}`;

  const bodyLines = [
    `Assunto: ${cleanSubjectChoice}`,
    `Nome: ${cleanName || 'Não informado'}`,
    `E-mail de contato: ${cleanEmail || 'Não informado'}`,
    '',
    'Descrição do problema:',
    cleanDescription,
  ];

  const encodedSubject = encodeURIComponent(emailSubject);
  const encodedBody = encodeURIComponent(bodyLines.join('\n'));

  return `mailto:${SUPPORT_EMAIL}?subject=${encodedSubject}&body=${encodedBody}`;
}
