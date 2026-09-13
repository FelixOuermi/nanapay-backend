import { z } from "zod";

// employer optionnel au niveau HTTP : une requete de "reutilisation" (dossier deja au
// dossier du client) peut arriver sans aucun champ ni fichier. Le service refuse
// explicitement si un nouveau dossier est necessaire mais incomplet.
export const submitDossierSchema = z.object({
  employer: z.string().min(1).optional(),
  registrationNumber: z.string().min(1).optional(),
});

export const bankCreditTermsSchema = z.object({
  months: z.coerce.number().int().positive(),
});
