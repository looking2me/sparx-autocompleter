/** Represents a school. */
class School {
    /**
     * Create a school.
     * 
     * @param {number} id - The ID of the school
     * @param {string} name - The name of the school
     * @param {string} slug - The slug of the school
     * @param {string} town - The town of the school
     * @param {string} address - The address of the school
     * @param {string[]} products - The products of the school
     */
    constructor(id, name, slug, town, address, products) {
        this.id = id;
        this.name = name;
        this.slug = slug;
        this.town = town;
        this.address = address;
        this.products = products;
    }
}

/** 
 * Get schools.
 * 
 * @returns {Promise<School[]>} The schools
 */
async function getSchools() {
    // Primary CDN — base64-encoded JSON list of all Sparx schools
    const PRIMARY_URL   = "https://static.sparxhomework.uk/sl/spx001/data.txt";
    // Fallback: the select-school page API used by the new Sparx Learning portal
    const FALLBACK_URL  = "https://selectschool.sparxmaths.uk/api/schools";

    let response;
    try {
        response = await fetch(PRIMARY_URL);
        if (!response.ok) throw new Error(`Primary CDN returned ${response.status}`);
    } catch (primaryErr) {
        // Try the fallback endpoint
        try {
            response = await fetch(FALLBACK_URL);
            if (!response.ok) throw new Error(`Fallback endpoint returned ${response.status}`);
            // Fallback returns plain JSON — parse directly and map fields
            const schools = await response.json();
            return schools.map(school => new School(
                school.id   ?? school.i,
                school.name ?? school.n,
                school.slug ?? school.u,
                school.town ?? school.t,
                school.address ?? school.a,
                school.products ?? school.p,
            ));
        } catch (fallbackErr) {
            throw new Error(`Failed to fetch school list from both endpoints.\n  Primary: ${primaryErr.message}\n  Fallback: ${fallbackErr.message}`);
        }
    }

    // Primary response is base64-encoded JSON
    const schools = JSON.parse(Buffer.from(await response.text(), "base64").toString("utf8"));
    return schools.map(school => new School(school.i, school.n, school.u, school.t, school.a, school.p));
}

export { School, getSchools };