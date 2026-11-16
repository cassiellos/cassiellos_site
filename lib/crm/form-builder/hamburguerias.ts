import type { FlowDefinition } from './flow'

/**
 * Modelo do curso Chronos adaptado à primeira campanha de hamburguerias.
 * O cadastro oficial permanece no Neon como rascunho, separado da publicação.
 * Não alegar atendimento de >100 hamburguerias sem evidência aprovada.
 *
 * IMPORTANTE: a finalização qualificada envia ao calendário oficial /agendar;
 * a integração de calendário EMBUTIDA no mesmo wizard ainda não existe no motor.
 */
export const HAMBURGUERIAS_CHRONOS_DRAFT:FlowDefinition={
  start:'name',
  cover:{
    headline:'🍔 Tráfego pago para hamburguerias que querem vender mais',
    bullets:[
      '📈 Campanhas para gerar demanda',
      '📲 Mais pedidos além do iFood',
      '🍔 Estratégias para seu mercado',
    ],
    qualifier:'Exclusivo para hamburguerias que faturam a partir de R$ 40 mil/mês e querem vender mais.',
    cta:'QUERO VENDER MAIS',
  },
  steps:[
    {id:'name',type:'question',title:'Qual é o seu nome?',description:'',
      input:'text',field:'name',required:true,options:[],next:'phone',branches:[]},
    {id:'phone',type:'question',title:'Qual é o seu número para contato?',description:'WhatsApp com DDD.',
      input:'text',field:'phone',required:true,options:[],next:'web',branches:[]},
    {id:'web',type:'question',title:'Qual é o Instagram ou site da sua hamburgueria?',description:'',
      input:'text',field:'website',required:true,options:[],next:'revenue',branches:[]},
    {id:'revenue',type:'question',title:'Qual é o faturamento mensal da sua hamburgueria?',description:'Escolha a faixa que melhor representa a média mensal do seu negócio.',
      input:'select',required:true,
      options:[
        'De R$ 30 mil a R$ 39 mil',
        'De R$ 40 mil a R$ 49 mil',
        'De R$ 50 mil a R$ 59 mil',
        'De R$ 60 mil a R$ 99 mil',
        'R$ 100 mil ou mais',
      ],
      next:'budget',branches:[{answer:'De R$ 30 mil a R$ 39 mil',to:'limited'}]},
    {id:'budget',type:'question',title:'R$ 30 por dia em anúncios cabem no seu planejamento?',
      description:'Para começar, recomendamos investir a partir de R$ 30 por dia (cerca de R$ 900/mês) em anúncios. Esse valor não inclui os serviços de gestão da agência.',
      input:'select',required:true,options:['Sim','Não'],next:'qualified',
      branches:[{answer:'Não',to:'limited'}]},
    {id:'qualified',type:'result',title:'Escolha a melhor data e horário',
      description:'Seu negócio está dentro dos critérios iniciais para uma conversa. Após enviar seu e-mail, selecione um horário disponível no calendário de agendamento da Cassiellos.',
      outcome:'qualified',actionLabel:'ESCOLHER DATA E HORÁRIO',actionHref:'/agendar'},
    {id:'limited',type:'result',title:'Obrigado pelo interesse!',
      description:'Neste momento, o formato de investimento pode não ser o mais indicado para sua hamburgueria. Deixe seus dados para que possamos conhecer seu momento e avaliar oportunidades futuras.',
      outcome:'limited',actionLabel:'',actionHref:''},
  ],
}
