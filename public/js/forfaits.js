/**
 * forfaits.js - Données centralisées des forfaits par opérateur
 * ================================================================
 * MODIFICATION DES PRIX : Changez uniquement ce fichier pour mettre à jour
 * les prix ou ajouter/supprimer des forfaits par opérateur.
 *
 * Structure : FORFAITS_DATA[operateur][categorie] = tableau d'offres
 * Chaque offre : { code, nom, desc, prix (en FCFA) }
 */

// ======================================================
// TAUX DE COMMISSION (×1.10 = +10% appliqué au paiement)
// Modifiez cette valeur pour changer le taux de commission
// ======================================================
const COMMISSION_RATE = 1.10;

// ======================================================
// PRÉFIXES TÉLÉPHONIQUES VALIDES PAR OPÉRATEUR (CI)
// Orange  → commence par 07
// MTN     → commence par 05
// MOOV    → commence par 01
// ======================================================
const OPERATOR_PREFIXES = {
  "Orange": ["07"],
  "MTN":    ["05"],
  "MOOV":   ["01"]
};

// ======================================================
// DONNÉES DES FORFAITS PAR OPÉRATEUR
// Chaque réseau a ses propres offres distinctes
// ======================================================
const FORFAITS_DATA = {

  /* --------- MTN --------- */
  "MTN": {
    "appels": [
      {
        "code": "mtn_appel_jour_500",
        "nom": "Appel Jours MTN",
        "desc": "20 Min 2 Jours",
        "prix": 200
      },
      {
        "code": "mtn_appel_nuit_200",
        "nom": "Appel Jours MTN",
        "desc": "35 min 2 Jours",
        "prix": 300
      },
      {
        "code": "mtn_appel_semaine_1000",
        "nom": "Appel Jours MTN",
        "desc": "70 min 5 Jours ",
        "prix": 500
      },
      {
        "code": "mtn_appel_mois_3000",
        "nom": "Appel Jours MTN",
        "desc": "140 min 10 Jours ",
        "prix": 1000
      }
    ],
    "internet": [
      {
        "code": "mtn_net_flash_100",
        "nom": "Internet MTN",
        "desc": "220 Mo valables 2 Jours",
        "prix": 200
      },
      {
        "code": "mtn_net_jour_200",
        "nom": "Internet MTN",
        "desc": "400 Mo 2 Jours",
        "prix": 300
      },
      {
        "code": "mtn_net_semaine_1000",
        "nom": "Internet MTN",
        "desc": "1,5 Go 5 jours",
        "prix": 1000
      },
      {
        "code": "mtn_net_nuit_150",
        "nom": "Internet MTN",
        "desc": "450 Mo 2 Jours ",
        "prix": 400
      },
      {
        "code": "mtn_net_mois_3000",
        "nom": " MTN C'Chic ",
        "desc": "650 Mo 1 jours",
        "prix": 200
      },
      {
        "code": "mtn_net_mois_3000_2",
        "nom": "MTN C'Chic ",
        "desc": "900 Mo 1 jours",
        "prix": 300
      },
      {
        "code": "mtn_net_mois_3000_3",
        "nom": "MTN C'Chic ",
        "desc": "1,5 Go 3 jours",
        "prix": 500
      }
    ]
    
  },

  /* --------- Orange --------- */
  "Orange": {
    "appels": [
      {
        "code": "org_appel_jour_100",
        "nom": "Appel Orange",
        "desc": "27 min + 50 Mo 3 Jours",
        "prix": 300
      },
      {
        "code": "org_appel_cchic_200",
        "nom": "Appel Orange",
        "desc": "17 min 1 jours ",
        "prix": 200
      },
      {
        "code": "org_appel_soir_150",
        "nom": "Appel semaine Orange",
        "desc": "100min + 1Go + 300 SMS  7 Jours",
        "prix": 1000
      },
      {
        "code": "org_appel_week_500",
        "nom": "Appel semaine Orange",
        "desc": "50 min + 250 Mo + 300 SMS 7 Jours",
        "prix": 500
      }
    ],
    "internet": [
      {
        "code": "org_net_jour_220",
        "nom": "Pass 3 jours orange ",
        "desc": "340 Mo 3 Jours",
        "prix": 300
      },
      {
        "code": "org_net_cchic_500",
        "nom": "Pass 3 Jours Orange",
        "desc": "340 Mo 3 Jours",
        "prix": 400
      },
      {
        "code": "org_net_mois_2000",
        "nom": "Pass 3 Jours Orange",
        "desc": "750 Mo 3 Jours",
        "prix": 700
      },
      {
        "code": "org_net_nuit_100",
        "nom": "Pass 2 Jours Orange",
        "desc": "220 Mo 2 Jours",
        "prix": 200
      },
      {
        "code": "org_net_nuit_100_2",
        "nom": "Pass 3 Jours Orange",
        "desc": "750 Mo 2 Jours",
        "prix": 500
      },
      {
        "code": "org_net_nuit_100_3",
        "nom": "Internet semaine Orange",
        "desc": "1,5 Go 2 Jours + Spotify",
        "prix": 1000
      }
    ]
  },

  /* --------- MOOV --------- */
  "MOOV": {
    "appels": [
      {
        "code": "moov_appel_jour_150",
        "nom": "MOOV Foli Appel",
        "desc": "12 min tous reseau 1 Jours",
        "prix": 150
      },
      {
        "code": "moov_appel_nuit_100",
        "nom": "MOOV Foli Appel",
        "desc": "20 min tous reseau 2 Jours",
        "prix": 200
      },
      {
        "code": "moov_appel_semaine_800",
        "nom": "MOOV Foli Appel ",
        "desc": " 35 Min tous reseau + 5 Fav 2 Jours",
        "prix": 300
      },
      {
        "code": "moov_appel_mois_2000",
        "nom": "MOOV Foli Appel",
        "desc": "70 min Tous Réseau + 5 Fav 5 jours",
        "prix": 500
      },
      {
        "code": "moov_appel_mois_2000_2",
        "nom": "MOOV Foli Appel",
        "desc": "140 min Tous Réseau + 5 Fav 15 jours",
        "prix": 1000
      },
      {
        "code": "moov_appel_mois_2000_3",
        "nom": "MOOV Foli Appel",
        "desc": "10 min Tous Réseau 1 jours",
        "prix": 150
      },
      {
        "code": "moov_appel_mois_2000_4",
        "nom": "MOOV Foli Appel",
        "desc": "17 Min Tous Réseau + 25 Mo + 50 SMS  5 jours",
        "prix": 200
      },
      {
        "code": "moov_appel_mois_2000_5",
        "nom": "MOOV Foli Appel",
        "desc": "27 min Tous Réseau + 100 Mo + 100 SMS 5 jours",
        "prix": 300
      },
      {
        "code": "moov_appel_mois_2000_6",
        "nom": "MOOV Foli Appel",
        "desc": "50 min Tous Réseau + 5 Fav (250) Mo & SMS 5 jours",
        "prix": 500
      }
    ],
    "internet": [
      {
        "code": "moov_net_flash_50",
        "nom": "MOOV Foli Internet",
        "desc": "650 Mo valables 1 Jours",
        "prix": 200
      },
      {
        "code": "moov_net_jour_100",
        "nom": "MOOV Foli Internet",
        "desc": "1,5 Go 3 Jours",
        "prix": 500
      },
      {
        "code": "moov_net_semaine_500",
        "nom": "MOOV Foli Internet",
        "desc": "900 Mo 1 jours",
        "prix": 300
      },
      {
        "code": "moov_net_mois_2500",
        "nom": "MOOV Foli Internet",
        "desc": "4 Go 5 jours",
        "prix": 1000
      }
    ]
  }
};

/**
 * Calcule le prix final avec commission (×1.10)
 * @param {number} prix - Prix de base en FCFA
 * @returns {number} - Prix arrondi avec commission
 */
function getPrixAvecCommission(prix) {
  return Math.round(prix * COMMISSION_RATE);
}

/**
 * Retourne les offres d'un opérateur pour une catégorie donnée
 * @param {string} operateur - 'MTN' | 'Orange' | 'MOOV'
 * @param {string} categorie - 'appels' | 'internet'
 * @returns {Array} - tableau d'offres ou []
 */
function getForfaits(operateur, categorie) {
  const op = FORFAITS_DATA[operateur];
  if (!op) return [];
  return op[categorie] || [];
}

/**
 * Valide que le numéro du receveur correspond au bon opérateur
 * @param {string} numero - numéro entré par l'utilisateur
 * @param {string} operateur - opérateur sélectionné
 * @returns {boolean}
 */
function validerNumeroReceveur(numero, operateur) {
  // Nettoyer le numéro : supprimer espaces et préfixe +225 ou 225
  let clean = (numero || '').replace(/\s+/g, '').replace(/^\+225|^225/, '');
  const prefixes = OPERATOR_PREFIXES[operateur] || [];
  // Vérifier que le numéro commence par le bon préfixe
  return prefixes.some(p => clean.startsWith(p));
}
