# Deploying JAXAtari-Viz to GitHub Pages

This project is configured to automatically deploy to GitHub Pages using GitHub Actions. Whenever you push changes to the `master` (or `main`) branch, a CI/CD pipeline will automatically build the React frontend and publish the static HTML/CSS/JS bundles.

## Setup Instructions

### 1. Ensure you have the GitHub Workflow file
The deployment pipeline is defined in `.github/workflows/deploy.yml`. Ensure this file is committed and pushed to your repository.

```bash
git add .github/workflows/deploy.yml
git commit -m "Add GitHub Actions deployment workflow"
git push origin master
```

### 2. Configure GitHub Pages in your Repository Settings
By default, GitHub Pages might look for a specific branch (like `gh-pages` or `main`). You need to configure it to use GitHub Actions instead:

1. Open your repository on **GitHub.com**.
2. Click on the **Settings** tab.
3. In the left-hand sidebar, scroll down and click on **Pages**.
4. Under the **Build and deployment** section, locate the **Source** dropdown menu.
5. Change the source from "Deploy from a branch" to **"GitHub Actions"**.

### 3. Trigger a Deployment
Once you've changed the source setting, GitHub Actions will handle the rest! 

- The workflow triggers automatically on every push to the `master` or `main` branch.
- You can monitor the progress by clicking the **Actions** tab at the top of your GitHub repository.
- Wait for the "Deploy static content to Pages" workflow to finish (it usually takes around 1-2 minutes).

### 4. View your Live Site
Once the deployment indicator turns green, your static site is live! You can find the URL in the Actions summary or at the top of the Pages settings menu.

It will typically be located at:  
`https://<your-username>.github.io/<repository-name>/`

---

## Updating the Data
Because the site is now static, it no longer dynamically reads new metrics. 
If you generate new experiment runs and want to update the dashboard:
1. Re-run your data export script to generate new JSON files inside `frontend/public/api/`.
2. Commit the new JSON files to git.
3. Push the changes to GitHub. The GitHub Action will automatically rebuild and deploy the new data!
