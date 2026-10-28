// The five scenarios on the wiki's Scenarios page. Each starts from one reference added while PIH ranks first.
// `expected` lists what the wiki says each one expands to; the tests hold the engine to it.

const ciel = (code) => `/orgs/CIEL/sources/CIEL/concepts/${code}/`;
const pih = (code) => `/orgs/PIH/sources/PIH/concepts/${code}/`;

export const SCENARIOS = [
  {
    id: '1',
    title: 'CIEL question, Yes/No/Unknown answers',
    summary: 'A CIEL question with no PIH equivalent. All three answers have PIH equivalents.',
    reference: { concept: ciel(161557), cascade: true },
    expected: {
      draft: [ciel(161557), pih(1065), pih(1066), pih(1067)],
    },
  },
  {
    id: '2',
    title: 'CIEL question, some answers in PIH',
    summary: 'A CIEL question with no PIH equivalent. Four of its six answers have PIH equivalents, with different codes.',
    reference: { concept: ciel(162820), cascade: true },
    expected: {
      draft: [ciel(162820), pih(1901), ciel(162821), pih(1900), ciel(162822), pih(1903), pih(7059)],
    },
  },
  {
    id: '3',
    title: 'Equivalent question, overlapping answers',
    summary: 'CIEL:163731 Tobacco use status ≡ PIH:2545 History of tobacco use. Three answers overlap; each source has one the other lacks.',
    reference: { concept: ciel(163731), cascade: true },
    expected: {
      draft: [pih(2545), pih(1090), pih(1548), pih(1550), pih(1067)],
      referenced: [pih(2545), pih(1090), pih(1548), pih(1550), ciel(165267)],
      union: [pih(2545), pih(1090), pih(1548), pih(1550), pih(1067), ciel(165267)],
    },
  },
  {
    id: '4',
    title: 'Equivalent set, different members and answers',
    summary: 'CIEL:159947 Visit diagnoses ≡ PIH:7539 Visit Diagnoses. The sets differ at both levels.',
    reference: { concept: ciel(159947), cascade: true },
    expected: {
      draft: [
        pih(7539), pih(3064), pih(7416), pih(1379), pih(1346), pih(1345), pih(7537), pih(7534), pih(7535),
        pih(7536), pih(7538), pih(13725), pih(12358), pih(13221), pih(12957), pih(13724), pih(6349), pih(10513),
      ],
      referenced: [
        pih(7539), pih(3064), pih(7416), pih(1379), pih(1346), pih(1345), ciel(160249), ciel(160250), ciel(161908),
        pih(7537), pih(7534), pih(7535), pih(7536), ciel(163139), pih(7538), ciel(162820), pih(1901), ciel(162821),
        pih(1900), ciel(162822), pih(1903), pih(7059),
      ],
    },
  },
  {
    id: '4b',
    title: 'Set not in PIH, equivalent member with different answers',
    summary: 'CIEL:161451 Stool test has no PIH equivalent. Its member CIEL:304 Stool exam ≡ PIH:304 Stool microscopy, with different answers.',
    reference: { concept: ciel(161451), cascade: true },
    expected: {
      draft: [
        ciel(161451), pih(304), pih(12266), pih(12264), pih(12269), pih(12261), pih(5622), pih(13352), pih(13353),
        pih(13384), pih(13363), ciel(161447), ciel(161448), pih(12268), pih(1138), pih(664), pih(703), ciel(161449),
        ciel(161450), pih(12271), pih(12270), pih(1408), pih(1409), pih(11432),
      ],
      referenced: [
        ciel(161451), pih(304), pih(12266), pih(12264), pih(12269), pih(12261), pih(5622), ciel(137329),
        ciel(161447), ciel(161448), pih(12268), pih(1138), pih(664), pih(703), ciel(161449), ciel(161450),
        pih(12271), pih(12270), pih(1408), pih(1409), pih(11432),
      ],
    },
  },
  {
    id: '5',
    title: 'Adding a CIEL concept that has a PIH equivalent',
    summary: 'Someone adds CIEL:1065 Yes on its own, without cascade. PIH:1065 Yes is its equivalent.',
    reference: { concept: ciel(1065), cascade: false },
    expected: {
      draft: [pih(1065)],
    },
  },
];
