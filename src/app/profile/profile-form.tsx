/**
 * The candidate profile form (spec §2).
 *
 * One form, submitted to a server action. Every field except name and email is
 * optional and stays null until filled in — the eligibility engine reads work
 * authorization and graduation date directly (spec §11), and a default it
 * invented would be worse than knowing nothing.
 */

import { RemotePreference } from "@prisma/client";
import type { Candidate } from "@prisma/client";
import type { ResumeSuggestions } from "@/lib/resume/parse-fields";
import {
  chooseFieldValue,
  chooseListValue,
  type Suggested,
} from "@/lib/resume/suggestions";
import { formatEnum } from "../jobs/format";
import { saveProfileAction } from "./actions";

/** Render a stored date as the `YYYY-MM` an `<input type="month">` wants. */
function monthValue(value: Date | null): string {
  if (!value) return "";
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * One labelled text input.
 *
 * When a resume import suggested a value, it fills the box and its evidence is
 * shown underneath. An existing profile value always wins: this screen must
 * never overwrite something the user typed with something a parser guessed.
 * Nothing is stored until the form is submitted — a suggestion is a draft, not
 * a fact (spec section 3).
 */
function Field({
  name,
  label,
  defaultValue,
  type = "text",
  placeholder,
  required = false,
  hint,
  suggestion,
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  type?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  suggestion?: Suggested<string>;
}) {
  // Which of the two wins is decided in one tested place — see
  // src/lib/resume/suggestions.ts for why that is not as trivial as it looks.
  const { value, fromSuggestion } = chooseFieldValue(defaultValue, suggestion);

  return (
    <label className={fromSuggestion ? "field field-suggested" : "field"}>
      <span>
        {label}
        {required ? <em className="req"> required</em> : null}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        required={required}
      />
      {fromSuggestion && suggestion ? (
        <small className="suggested">
          <strong>{suggestion.source === "ai" ? "AI" : "From your resume"}:</strong>{" "}
          {suggestion.evidence}
        </small>
      ) : null}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

/** One labelled multi-value textarea (comma or newline separated). */
function ListField({
  name,
  label,
  defaultValue,
  placeholder,
  suggestion,
}: {
  name: string;
  label: string;
  defaultValue: string[];
  placeholder?: string;
  suggestion?: Suggested<string[]>;
}) {
  const { values, fromSuggestion } = chooseListValue(defaultValue, suggestion);

  return (
    <label
      className={
        fromSuggestion ? "field field-wide field-suggested" : "field field-wide"
      }
    >
      <span>{label}</span>
      <textarea name={name} rows={3} defaultValue={values.join(", ")} placeholder={placeholder} />
      {fromSuggestion && suggestion ? (
        <small className="suggested">
          <strong>{suggestion.source === "ai" ? "AI" : "From your resume"}:</strong>{" "}
          {suggestion.evidence}
        </small>
      ) : null}
      <small>Separate with commas or new lines.</small>
    </label>
  );
}

export function ProfileForm({
  profile,
  suggestions = {},
}: {
  profile: Candidate | null;
  /** Values read from an uploaded resume, awaiting review. */
  suggestions?: ResumeSuggestions;
}) {
  return (
    <form className="stack" action={saveProfileAction}>
      <fieldset>
        <legend>Who you are</legend>
        <div className="grid">
          <Field
            name="name"
            label="Full name"
            defaultValue={profile?.name}
            suggestion={suggestions.name}
            required
          />
          <Field
            name="email"
            label="Email"
            type="email"
            defaultValue={profile?.email}
            suggestion={suggestions.email}
            required
          />
          <Field
            name="phone"
            label="Phone"
            defaultValue={profile?.phone}
            suggestion={suggestions.phone}
          />
          <Field
            name="address"
            label="Location / address"
            defaultValue={profile?.address}
            suggestion={suggestions.address}
          />
          <Field
            name="linkedinUrl"
            label="LinkedIn"
            defaultValue={profile?.linkedinUrl}
            suggestion={suggestions.linkedinUrl}
          />
          <Field
            name="githubUrl"
            label="GitHub"
            defaultValue={profile?.githubUrl}
            suggestion={suggestions.githubUrl}
          />
          <Field
            name="portfolioUrl"
            label="Portfolio"
            defaultValue={profile?.portfolioUrl}
            suggestion={suggestions.portfolioUrl}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend>School</legend>
        <div className="grid">
          <Field
            name="school"
            label="School"
            defaultValue={profile?.school}
            suggestion={suggestions.school}
          />
          <Field
            name="degree"
            label="Degree"
            defaultValue={profile?.degree}
            suggestion={suggestions.degree}
            placeholder="BS Computer Science"
          />
          <Field
            name="graduationDate"
            label="Expected graduation"
            type="month"
            defaultValue={monthValue(profile?.graduationDate ?? null)}
            suggestion={suggestions.graduationDate}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend>Eligibility</legend>
        <p className="note">
          These decide which jobs you are shown. Leave anything
          you are unsure about blank — a blank field means &ldquo;unknown&rdquo;,
          which is safe; a wrong one makes the bot apply to jobs you cannot take.
        </p>
        <div className="grid">
          <Field
            name="workAuthorization"
            label="Work authorization"
            defaultValue={profile?.workAuthorization}
            placeholder="US Citizen / OPT / CPT / H1B needed"
          />
          <Field
            name="citizenship"
            label="Citizenship"
            defaultValue={profile?.citizenship}
            hint="Only matters for clearance or citizenship-restricted roles."
          />
          <label className="field field-check">
            <input
              type="checkbox"
              name="needsSponsorship"
              defaultChecked={profile?.needsSponsorship ?? false}
            />
            <span>I will need visa sponsorship, now or later</span>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>What you are looking for</legend>
        <div className="grid">
          <label className="field">
            <span>Remote preference</span>
            <select
              name="remotePreference"
              defaultValue={profile?.remotePreference ?? RemotePreference.ANY}
            >
              {Object.values(RemotePreference).map((preference) => (
                <option key={preference} value={preference}>
                  {formatEnum(preference)}
                </option>
              ))}
            </select>
          </label>
          <Field
            name="minimumSalary"
            label="Minimum salary"
            defaultValue={profile?.minimumSalary}
            hint="Whole number, no currency symbol. Blank means no minimum."
          />
          <Field
            name="yearsOfExperience"
            label="Years of experience"
            defaultValue={profile?.yearsOfExperience}
            hint="Full-time years only — internships and coursework don't count. Most students answer 0. Blank means you'd rather not say, and postings asking for more years will be flagged instead of ruled out."
          />
        </div>
        <div className="grid">
          <ListField
            name="preferredLocations"
            label="Preferred locations"
            defaultValue={profile?.preferredLocations ?? []}
            placeholder="NYC, Boston, Remote"
          />
          <ListField
            name="desiredRoles"
            label="Desired roles"
            defaultValue={profile?.desiredRoles ?? []}
            placeholder="Software Engineering Intern, Data Science Intern"
          />
          <ListField
            name="skills"
            label="Skills"
            defaultValue={profile?.skills ?? []}
            suggestion={suggestions.skills}
            placeholder="Python, TypeScript, SQL"
          />
          <ListField
            name="certifications"
            label="Certifications"
            defaultValue={profile?.certifications ?? []}
          />
        </div>
      </fieldset>

      <div className="form-actions">
        <button type="submit">Save profile</button>
      </div>
    </form>
  );
}
